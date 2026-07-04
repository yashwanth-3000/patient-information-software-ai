const http = require("node:http");
const { URL } = require("node:url");

const port = Number(process.env.PORT || 3000);
const adminKey = process.env.ADMIN_KEY || "local-development-only";

const seedJobs = Object.freeze([
  {
    id: "vultr-demo-patient-001",
    clinic_id: "clinic-demo",
    status: "approved",
    patient: {
      first_name: "APPDEMOONE",
      last_name: "PATIENT",
      age: 31,
      gender: "M",
      address: "VULTR DEMO 1",
      first_visit: "2026-07-04"
    },
    prescriptions: [
      {
        text: "DEMO IMPORT FROM CLINICCLICK APP - NOT FOR TREATMENT",
        date: "2026-07-04"
      }
    ]
  },
  {
    id: "vultr-demo-patient-002",
    clinic_id: "clinic-demo",
    status: "approved",
    patient: {
      first_name: "APPDEMOTWO",
      last_name: "PATIENT",
      age: 42,
      gender: "F",
      address: "VULTR DEMO 2",
      first_visit: "2026-07-04"
    },
    prescriptions: [
      {
        text: "DEMO SECOND IMPORT - NOT FOR TREATMENT",
        date: "2026-07-04"
      }
    ]
  }
]);

let importedIds = new Set();

// Live patient lookup relay: the web caller long-polls while the PIS plugin
// picks up the query, reads the local Access database, and posts the answer.
let queryCounter = 0;
const patientQueries = new Map();
const QUERY_TIMEOUT_MS = 25000;

function dropStaleQueries() {
  const now = Date.now();
  for (const [id, query] of patientQueries) {
    if (now - query.createdAt > QUERY_TIMEOUT_MS * 2) patientQueries.delete(id);
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isAdmin(req) {
  const supplied = req.headers["x-admin-key"] || "";
  return supplied.length > 0 && supplied === adminKey;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "clinicclick-demo-api" });
  }

  if (req.method === "GET" && url.pathname === "/api/pis/pending") {
    const clinicId = url.searchParams.get("clinic_id");
    if (clinicId !== "clinic-demo") {
      return sendJson(res, 400, { error: "Unknown clinic_id" });
    }
    const jobs = seedJobs.filter(job => !importedIds.has(job.id));
    return sendJson(res, 200, { jobs });
  }

  const patientMatch = url.pathname.match(/^\/api\/patients\/(\d+)$/);
  if (req.method === "GET" && patientMatch) {
    dropStaleQueries();
    const regno = Number(patientMatch[1]);
    const id = `q${++queryCounter}-${Date.now()}`;
    const query = { id, regno, status: "pending", result: null, createdAt: Date.now() };
    patientQueries.set(id, query);

    const started = Date.now();
    const poll = () => {
      if (query.status === "answered") {
        patientQueries.delete(id);
        const found = query.result && query.result.found === true;
        return sendJson(res, found ? 200 : 404, query.result);
      }
      if (Date.now() - started > QUERY_TIMEOUT_MS) {
        patientQueries.delete(id);
        return sendJson(res, 504, {
          error: "The clinic PIS did not answer in time. Is it running?"
        });
      }
      setTimeout(poll, 250);
    };
    poll();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pis/queries") {
    const clinicId = url.searchParams.get("clinic_id");
    if (clinicId !== "clinic-demo") {
      return sendJson(res, 400, { error: "Unknown clinic_id" });
    }
    dropStaleQueries();
    const pending = [...patientQueries.values()]
      .filter(query => query.status === "pending")
      .map(query => ({ id: query.id, regno: query.regno }));
    return sendJson(res, 200, { queries: pending });
  }

  const queryResultMatch = url.pathname.match(/^\/api\/pis\/queries\/([^/]+)\/result$/);
  if (req.method === "POST" && queryResultMatch) {
    const id = decodeURIComponent(queryResultMatch[1]);
    const query = patientQueries.get(id);
    if (!query) return sendJson(res, 404, { error: "Query not found or expired" });
    try {
      query.result = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" });
    }
    query.status = "answered";
    return sendJson(res, 200, { ok: true, id });
  }

  const ackMatch = url.pathname.match(/^\/api\/pis\/jobs\/([^/]+)\/ack$/);
  if (req.method === "POST" && ackMatch) {
    const id = decodeURIComponent(ackMatch[1]);
    if (!seedJobs.some(job => job.id === id)) {
      return sendJson(res, 404, { error: "Job not found" });
    }
    importedIds.add(id);
    return sendJson(res, 200, { ok: true, id });
  }

  if (req.method === "POST" && url.pathname === "/api/demo/reset") {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "Unauthorized" });
    importedIds = new Set();
    return sendJson(res, 200, { ok: true, pending: seedJobs.length });
  }

  if (req.method === "POST" && url.pathname === "/api/demo/inspect") {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "Unauthorized" });
    return sendJson(res, 200, {
      total: seedJobs.length,
      imported: [...importedIds],
      pending: seedJobs.filter(job => !importedIds.has(job.id)).map(job => job.id)
    });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-admin-key"
    });
    return res.end();
  }

  if (req.method === "POST") {
    try { await readJson(req); } catch { }
  }
  return sendJson(res, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ClinicClick demo API listening on ${port}`);
});

module.exports = { server, seedJobs };
