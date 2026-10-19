import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDocHtml, htmlToText, slugify, uniqueSlug } from "../server/lib/resources";
import { folderIdFrom } from "../server/lib/googleDrive";

test("slugify makes stable, readable addresses", () => {
  assert.equal(slugify("Holidays SOP"), "holidays-sop");
  assert.equal(slugify("OMS Application: Standard Operating Procedures & FAQ"), "oms-application-standard-operating-procedures-and-faq");
  assert.equal(slugify("  Café — Rules!  "), "cafe-rules");
  assert.equal(slugify("!!!"), "resource");
  assert.ok(slugify("a ".repeat(100)).length <= 60);
  assert.ok(!slugify("a ".repeat(100)).endsWith("-"));
});

test("uniqueSlug numbers duplicates", () => {
  assert.equal(uniqueSlug("pto", new Set()), "pto");
  assert.equal(uniqueSlug("pto", new Set(["pto"])), "pto-2");
  assert.equal(uniqueSlug("pto", new Set(["pto", "pto-2"])), "pto-3");
});

test("cleanDocHtml removes anything active", () => {
  const out = cleanDocHtml('<html><head><script>alert(1)</script></head><body><p onclick="x()">Hi</p><a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe><img src=x onerror=alert(1)></body></html>');
  assert.ok(!/script>|onclick|onerror|javascript:|<iframe/i.test(out), out);
  assert.match(out, /<p>Hi<\/p>/);
  assert.match(out, /<base target="_blank">/);
});

test("cleanDocHtml unwraps Google's link redirects", () => {
  const out = cleanDocHtml('<a href="https://www.google.com/url?q=https://locdoc.net/a%3Fb%3D1&amp;sa=D&amp;ust=1">x</a>');
  assert.match(out, /href="https:\/\/locdoc\.net\/a\?b=1"/);
});

test("cleanDocHtml wraps fragments in a page", () => {
  assert.match(cleanDocHtml("<p>x</p>"), /^<!doctype html><html><head>.*<\/head><body><p>x<\/p><\/body><\/html>$/);
});

test("htmlToText drops styles and tags and decodes entities", () => {
  assert.equal(htmlToText("<head><style>p{color:red}</style></head><p>Tom &amp; Jerry&nbsp;&#8217;s</p><p>next</p>"), "Tom & Jerry ’s next");
});

test("folderIdFrom accepts links and bare ids, rejects junk", () => {
  assert.equal(folderIdFrom("https://drive.google.com/drive/folders/1AbC_def-GHIjklmnop?usp=sharing"), "1AbC_def-GHIjklmnop");
  assert.equal(folderIdFrom("https://drive.google.com/open?id=1AbC_def-GHIjklmnop"), "1AbC_def-GHIjklmnop");
  assert.equal(folderIdFrom("1AbC_def-GHIjklmnop"), "1AbC_def-GHIjklmnop");
  assert.equal(folderIdFrom("' or 1=1"), null);
  assert.equal(folderIdFrom(""), null);
});
