const { test, after } = require("node:test");
const assert = require("node:assert/strict");
process.env.PORT = "0";
const { server } = require("./server");

after(() => server.close());

test("health and pending demo jobs", async () => {
  await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/health`).then(response => response.json());
  assert.equal(health.ok, true);

  const pending = await fetch(`${base}/api/pis/pending?clinic_id=clinic-demo`).then(response => response.json());
  assert.equal(pending.jobs.length, 2);
  assert.equal(pending.jobs[0].status, "approved");
});

test("patient query relay round trip", async () => {
  await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const webRequest = fetch(`${base}/api/patients/27531`);

  let queries = [];
  for (let i = 0; i < 20 && queries.length === 0; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const body = await fetch(`${base}/api/pis/queries?clinic_id=clinic-demo`).then(r => r.json());
    queries = body.queries;
  }
  assert.equal(queries.length, 1);
  assert.equal(queries[0].regno, 27531);

  const answer = {
    found: true,
    patient: { regno: 27531, first_name: "APPDEMOONE", last_name: "PATIENT" },
    prescriptions: [{ text: "DEMO", date: "2026-07-04" }]
  };
  const posted = await fetch(`${base}/api/pis/queries/${queries[0].id}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(answer)
  }).then(r => r.json());
  assert.equal(posted.ok, true);

  const response = await webRequest;
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.found, true);
  assert.equal(result.patient.regno, 27531);
});
