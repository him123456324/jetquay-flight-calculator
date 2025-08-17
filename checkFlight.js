const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path'); // ADDED

const app = express();
const PORT = process.env.PORT || 3000; // <— only change

app.use(cors());

// ADDED: serve static files from /public and default to index.html
app.use(express.static(path.join(__dirname, 'public'))); // ADDED
app.get('/', (req, res) => { // ADDED
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // ADDED
}); // ADDED

const API_HEADERS = {
  'Authorization': 'Bearer 0198b765-d078-71af-9d47-e7fa212e9b27|7yCrr7c4tX5SHMJTx2XQUEeiG4u3poO2pTMII3oo8b099cf1',
  'Accept': 'application/json',
  'Accept-Version': 'v1'
};

// --- SGT helper (keep) ---
const toIsoWithOffset = (iso, offsetMinutes) => {
  if (!iso) return null;
  const t = new Date(iso).getTime() + offsetMinutes * 60 * 1000;
  const d = new Date(t);
  const pad = n => String(n).padStart(2, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const offH = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offM = pad(Math.abs(offsetMinutes) % 60);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
         `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${sign}${offH}:${offM}`;
};
const toSgtIso = (iso) => toIsoWithOffset(iso, 480); // UTC+8

// --- NEW: Service time + Gates logic ---
const SERVICE_TIME_MIN = 52;

const parseGate = (g) => {
  if (!g) return null;
  const m = /^([A-Ga-g])\s*(\d+)?$/.exec(String(g).trim());
  if (!m) return null;
  return { letter: m[1].toUpperCase(), number: m[2] ? parseInt(m[2], 10) : null };
};
const inRange = (n, a, b) => n >= a && n <= b;

// minutes since midnight in SGT
const sgtMinutesOfDay = () => {
  const now = new Date();
  const sgtMs = now.getTime() + 480 * 60 * 1000; // shift to SGT
  const d = new Date(sgtMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

// Skytrain windows
const skytrainHIM = () => {
  const m = sgtMinutesOfDay();
  if (m >= 300 && m < 720) return 8;         // 05:00–12:00
  if (m >= 720 && m < 1020) return 5;        // 12:00–17:00
  if (m >= 1020 || m < 120) return 3;        // 17:00–02:00
  if (m >= 120 && m < 300) return 7;         // 02:00–05:00
  return 7;                                   // fallback
};
const skytrainHER = () => {
  const m = sgtMinutesOfDay();
  if (m >= 300 && m < 720) return 6;         // 05:00–12:00
  if (m >= 720 && m < 1020) return 5;        // 12:00–17:00
  if (m >= 1020 || m < 120) return 3;        // 17:00–02:00
  if (m >= 120 && m < 300) return 7;         // 02:00–05:00
  return 7;                                   // fallback
};

// Core routing table
const gateMinutes = (firstGate, secondGate) => {
  const g1 = parseGate(firstGate);
  const g2 = parseGate(secondGate);
  if (!g1 || !g2 || !g2.number) return { minutes: 0, note: 'Gate input missing/invalid' };

  const L1 = g1.letter, L2 = g2.letter, N2 = g2.number;

  // FIRST GATE: A or B
  if (L1 === 'A' || L1 === 'B') {
    if (L2 === 'G') {
      if (inRange(N2, 7, 10)) return { minutes: 24 };
      if (inRange(N2, 4, 6))  return { minutes: 23 };
      if (inRange(N2, 1, 3))  return { minutes: 22 };
      return { minutes: 0, note: 'Undefined G gate for A/B->G (expect G1–G10)' };
    }
    if (L2 === 'A') {
      if (inRange(N2, 1, 10))  return { minutes: 5 };
      if (inRange(N2, 11, 12)) return { minutes: 6 };
      if (inRange(N2, 13, 14)) return { minutes: 7 };
      if (inRange(N2, 15, 21)) return { minutes: 10 };
      return { minutes: 0, note: 'Undefined A gate range' };
    }
    if (L2 === 'B') {
      if (inRange(N2, 1, 4))  return { minutes: 5 };
      if (inRange(N2, 5, 6))  return { minutes: 6 };
      if (N2 === 7)           return { minutes: 7 };
      if (N2 === 8)           return { minutes: 8 };
      if (N2 === 9)           return { minutes: 9 };
      if (N2 === 10)          return { minutes: 10 };
      return { minutes: 0, note: 'Undefined B gate range' };
    }
    if (L2 === 'C') {
      if (inRange(N2, 1, 3))  return { minutes: 10 };
      if ([11,12,13,14,15,21,22,23].includes(N2)) return { minutes: 12 };
      if (inRange(N2, 16, 19) || inRange(N2, 24, 26)) return { minutes: 14 };
      return { minutes: 0, note: 'Undefined C gate range' };
    }
    if (L2 === 'D') {
      if (N2 === 40) return { minutes: 14 };
      if (N2 === 30 || N2 === 46) return { minutes: 15 };
      if (inRange(N2, 31, 34) || N2 === 47) return { minutes: 16 };
      if (inRange(N2, 35, 37) || N2 === 48 || N2 === 49) return { minutes: 17 };
      return { minutes: 0, note: 'Undefined D gate range' };
    }
    if (L2 === 'E') {
      const base =
        (inRange(N2, 20, 21) || inRange(N2, 1, 4)) ? 4 :
        (inRange(N2, 22, 23) || inRange(N2, 5, 12)) ? 5 :
        (inRange(N2, 24, 25)) ? 6 :
        (N2 === 28) ? 7 : null;
      if (base == null) return { minutes: 0, note: 'Undefined E gate range' };
      return { minutes: skytrainHIM() + base, skytrain: 'HIM' };
    }
    if (L2 === 'F') {
      const base =
        (inRange(N2, 50, 51) || inRange(N2, 30, 33)) ? 3 :
        (inRange(N2, 52, 53) || inRange(N2, 34, 37) || inRange(N2, 41, 42)) ? 4 :
        (inRange(N2, 54, 55)) ? 5 :
        (inRange(N2, 56, 57)) ? 6 :
        (inRange(N2, 58, 60)) ? 7 : null;
      if (base == null) return { minutes: 0, note: 'Undefined F gate range' };
      return { minutes: skytrainHER() + base, skytrain: 'HER' };
    }
  }

  // FIRST GATE: C or D
  if (L1 === 'C' || L1 === 'D') {
    if (L2 === 'G') {
      if (inRange(N2, 1, 3))   return { minutes: 26 };
      if (inRange(N2, 4, 6))   return { minutes: 25 };
      if (inRange(N2, 7, 10))  return { minutes: 23 };
      if (inRange(N2, 11, 13)) return { minutes: 24 };
      if (inRange(N2, 14, 16)) return { minutes: 25 };
      if (inRange(N2, 17, 20)) return { minutes: 26 };
      if (N2 === 21)           return { minutes: 27 };
      return { minutes: 0, note: 'Undefined G gate range' };
    }
    if (L2 === 'C') {
      if (inRange(N2, 1, 3)) return { minutes: 4 };
      if ([11,12,13,14,15,21,22,23].includes(N2)) return { minutes: 5 };
      if (inRange(N2, 16, 19) || inRange(N2, 24, 26)) return { minutes: 6 };
      return { minutes: 0, note: 'Undefined C gate range' };
    }
    if (L2 === 'D') {
      if (N2 === 40) return { minutes: 4 };
      if (N2 === 30 || N2 === 46) return { minutes: 5 };
      if (inRange(N2, 31, 34)) return { minutes: 6 };
      if (inRange(N2, 35, 37) || inRange(N2, 48, 49)) return { minutes: 7 };
      return { minutes: 0, note: 'Undefined D gate range' };
    }
    if (L2 === 'E') {
      if (N2 === 28) return { minutes: 5 };
      if (inRange(N2, 26, 27)) return { minutes: 6 };
      if (inRange(N2, 24, 25)) return { minutes: 7 };
      if (inRange(N2, 22, 23)) return { minutes: 8 };
      if (inRange(N2, 20, 21)) return { minutes: 9 };
      if (inRange(N2, 1, 4) || N2 === 10) return { minutes: 10 };
      if (inRange(N2, 5, 9) || inRange(N2, 11, 12)) return { minutes: 12 };
      return { minutes: 0, note: 'Undefined E gate range' };
    }
    if (L2 === 'F') {
      if (inRange(N2, 50, 51) || inRange(N2, 30, 33) || N2 === 40) return { minutes: 12 };
      if (inRange(N2, 52, 53) || inRange(N2, 34, 39) || inRange(N2, 41, 42)) return { minutes: 13 };
      if (inRange(N2, 54, 55)) return { minutes: 14 };
      if (inRange(N2, 56, 57)) return { minutes: 15 };
      if (inRange(N2, 58, 60)) return { minutes: 16 };
      return { minutes: 0, note: 'Undefined F gate range' };
    }
  }

  // FIRST GATE: E or F  (use same logic as C/D; G uses C/D->G mapping)
  if (L1 === 'E' || L1 === 'F') {
    if (L2 === 'G') return gateMinutes('C', secondGate); // reuse C/D -> G logic
    if (L2 === 'C') return gateMinutes('C', secondGate);
    if (L2 === 'D') return gateMinutes('D', secondGate);
    if (L2 === 'E') return gateMinutes('D', 'E' + N2); // use C/D -> E table
    if (L2 === 'F') return gateMinutes('D', 'F' + N2); // use C/D -> F table
  }

  // Not specified cases (e.g., C/D -> A/B): default 0
  return { minutes: 0, note: 'No rule defined for this gate pair' };
};

const getFlightData = async (flight, date, limit = 3) => {
  const from = `${date}T00:00:00`;
  const to = `${date}T23:59:59`;

  const response = await axios.get('https://fr24api.flightradar24.com/api/flight-summary/full', {
    headers: API_HEADERS,
    params: {
      flight_datetime_from: from,
      flight_datetime_to: to,
      flights: flight,
      limit,
      sort: 'desc'
    }
  });

  return response.data.data || [];
};

const estimateArrival = async (flightObj, date) => {
  const { datetime_takeoff, datetime_landed, flight_ended, flight } = flightObj;

  if (flight_ended && datetime_landed) {
    return datetime_landed;
  }

  if (datetime_takeoff) {
    const durations = [];

    for (let i = 1; i <= 5; i++) {
      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - i);
      const prevDateStr = prevDate.toISOString().split('T')[0];
      const prevFlights = await getFlightData(flight, prevDateStr, 3);

      for (const f of prevFlights) {
        if (f.flight_ended && f.datetime_takeoff && f.datetime_landed) {
          const dur = new Date(f.datetime_landed) - new Date(f.datetime_takeoff);
          if (dur > 0) durations.push(dur);
        }
      }

      if (durations.length >= 3) break;
    }

    if (durations.length > 0) {
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      return new Date(new Date(datetime_takeoff).getTime() + avgDuration).toISOString();
    }
  }

  return null;
};

// --------- /api/flight (unchanged except SGT output) ---------
app.get('/api/flight', async (req, res) => {
  const { flight, date } = req.query;

  if (!flight || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid or missing flight/date' });
  }

  try {
    const todayFlights = await getFlightData(flight, date, 1);
    const todayFlight = todayFlights[0];

    if (!todayFlight) {
      return res.status(404).json({ error: 'No current flight found' });
    }

    const estimated_arrival_utc = await estimateArrival(todayFlight, date);
    const estimated_arrival = toSgtIso(estimated_arrival_utc);

    return res.json({
      flightData: todayFlight,
      estimated_arrival
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// --------- /api/calculate (now supports gates + absolute timing + delay timings) ---------
app.get('/api/calculate', async (req, res) => {
  const { flight1, date1, flight2, date2, firstGate, secondGate } = req.query;

  if (!flight1 || !date1 || !flight2 || !date2) {
    return res.status(400).json({ error: 'Missing flight or date parameters' });
  }

  try {
    const [flights1, flights2] = await Promise.all([
      getFlightData(flight1, date1, 1),
      getFlightData(flight2, date2, 1)
    ]);

    const flightObj1 = flights1[0];
    const flightObj2 = flights2[0];

    if (!flightObj1 || !flightObj2) {
      return res.status(404).json({ error: 'One or both flights not found' });
    }

    const [est1Utc, est2Utc] = await Promise.all([
      estimateArrival(flightObj1, date1),
      estimateArrival(flightObj2, date2)
    ]);

    if (!est1Utc || !est2Utc) {
      return res.status(400).json({ error: 'Could not estimate one or both arrivals' });
    }

    // Base difference (no delays)
    const base_difference_minutes = Math.round(
      Math.abs(new Date(est1Utc) - new Date(est2Utc)) / 60000
    );

    // --- UPDATED: delay timings calculation (per-flight, then summed) ---
    const extractAirline = (obj) =>
      String(obj.airline_name || obj.airline?.name || obj.operator?.name || '').toLowerCase();
    const extractAircraft = (obj) =>
      String(obj.aircraft?.model?.text || obj.aircraft?.model || obj.aircraft?.type || obj.model || '').toLowerCase();

    // NEW RULES:
    const delayFor = (obj) => {
      const airline = extractAirline(obj);
      const aircraft = extractAircraft(obj).trim();
      let add = 0;

      const airlineAdd10 = [
        'scoot',
        'air asia',
        'airasia',
        'china eastern',
        'china easten',
        'indigo',
        'air india'
      ];
      if (airlineAdd10.some(k => airline.includes(k))) add += 10;

      const aircraftAdd10Contains = ['767-300er', '767-400er'];
      if (aircraftAdd10Contains.some(k => aircraft.includes(k))) add += 10;

      if (aircraft === 'a320') add += 10;

      return add;
    };

    const delay_timings_minutes = delayFor(flightObj1) + delayFor(flightObj2);
    const difference_with_delays_minutes = base_difference_minutes + delay_timings_minutes;

    const g = gateMinutes(firstGate, secondGate);
    const gates_minutes = g.minutes || 0;

    const absolute_timing_minutes = Math.round(difference_with_delays_minutes - gates_minutes);

    const message = (absolute_timing_minutes < SERVICE_TIME_MIN)
      ? 'Please inform OC'
      : undefined;

    return res.json({
      flight1: { flight: flight1, estimated_arrival: toSgtIso(est1Utc) },
      flight2: { flight: flight2, estimated_arrival: toSgtIso(est2Utc) },
      difference_minutes: base_difference_minutes,
      delay_timings_minutes,
      difference_with_delays_minutes,
      service_time_minutes: SERVICE_TIME_MIN,
      gates: {
        firstGate: firstGate || null,
        secondGate: secondGate || null,
        minutes: gates_minutes,
        skytrain: g.skytrain || null,
        note: g.note || null
      },
      absolute_timing_minutes,
      message
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
