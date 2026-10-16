// can() / reach() matrix: every scope shape, allowed AND denied, including cross-company.
// Run: npx tsx --test tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { can, canAnywhereIn, reach, type Access, type Grant } from "../server/auth/permissions";

const LOCDOC = "c-locdoc";
const BUFFALO = "c-buffalo";
const SERVICE = "d-service";
const ACCOUNTING = "d-accounting";

const person = (companyId: string, grants: Grant[]): Access => ({ employeeId: "e1", companyId, grants });
const g = (permission: string, scope: Grant["scope"]): Grant => ({ permission, scope });

const superAdmin = person(LOCDOC, [g("employees.view", { type: "global" }), g("system.admin", { type: "global" })]);
const companyAdmin = person(LOCDOC, [g("employees.view", { type: "company", companyId: LOCDOC })]);
const serviceManager = person(LOCDOC, [
  g("employees.view", { type: "company", companyId: LOCDOC }), // implicit employee directory access
  g("reports.view_team", { type: "department", companyId: LOCDOC, departmentId: SERVICE }),
]);
const scorecardUploader = person(LOCDOC, [g("driver_scorecard.upload", { type: "company", companyId: LOCDOC })]);
const buffaloEmployee = person(BUFFALO, [g("employees.view", { type: "company", companyId: BUFFALO })]);

test("super admin: everything, every company", () => {
  assert.equal(can(superAdmin, "employees.view", { companyId: LOCDOC }), true);
  assert.equal(can(superAdmin, "employees.view", { companyId: BUFFALO }), true);
  assert.equal(can(superAdmin, "system.admin"), true);
});

test("company scope: own company only", () => {
  assert.equal(can(companyAdmin, "employees.view", { companyId: LOCDOC, departmentIds: [SERVICE] }), true);
  assert.equal(can(companyAdmin, "employees.view", { companyId: BUFFALO }), false);
  assert.equal(can(companyAdmin, "system.admin"), false);
});

test("department scope: own departments only, never the other company", () => {
  assert.equal(can(serviceManager, "reports.view_team", { companyId: LOCDOC, departmentIds: [SERVICE] }), true);
  assert.equal(can(serviceManager, "reports.view_team", { companyId: LOCDOC, departmentIds: [ACCOUNTING] }), false);
  assert.equal(can(serviceManager, "reports.view_team", { companyId: LOCDOC }), false, "no department named = not covered");
  assert.equal(can(serviceManager, "reports.view_team", { companyId: BUFFALO, departmentIds: [SERVICE] }), false);
});

test("single-tool role grants exactly one tool", () => {
  assert.equal(can(scorecardUploader, "driver_scorecard.upload", { companyId: LOCDOC }), true);
  assert.equal(can(scorecardUploader, "bonus.manage", { companyId: LOCDOC }), false);
  assert.equal(can(scorecardUploader, "shop.admin"), false);
});

test("directory: each company sees its own people, not the other's", () => {
  assert.equal(can(buffaloEmployee, "employees.view", { companyId: BUFFALO }), true);
  assert.equal(can(buffaloEmployee, "employees.view", { companyId: LOCDOC }), false);
});

test("no access object (no employee profile) can do nothing", () => {
  assert.equal(can(null, "employees.view"), false);
  assert.deepEqual(reach(null, "employees.view"), { all: false, companyIds: [], departmentIds: [] });
});

test("'anywhere' check (no target) is true if any grant exists", () => {
  assert.equal(can(serviceManager, "reports.view_team"), true);
  assert.equal(can(serviceManager, "bonus.manage"), false);
});

test("reach() summarizes scopes for list filtering", () => {
  assert.deepEqual(reach(superAdmin, "employees.view"), { all: true, companyIds: [], departmentIds: [] });
  assert.deepEqual(reach(serviceManager, "reports.view_team"), { all: false, companyIds: [], departmentIds: [SERVICE] });
  assert.deepEqual(reach(companyAdmin, "employees.view"), { all: false, companyIds: [LOCDOC], departmentIds: [] });
});

test("canAnywhereIn: a department-scoped role counts for company-level features, never across companies", () => {
  const deptMgr = person(LOCDOC, [g("meetings.manage", { type: "department", companyId: LOCDOC, departmentId: SERVICE })]);
  assert.equal(canAnywhereIn(deptMgr, "meetings.manage", LOCDOC), true);
  assert.equal(canAnywhereIn(deptMgr, "meetings.manage", BUFFALO), false);
  assert.equal(canAnywhereIn(superAdmin, "system.admin", BUFFALO), true);
  assert.equal(canAnywhereIn(buffaloEmployee, "meetings.manage", BUFFALO), false);
});
