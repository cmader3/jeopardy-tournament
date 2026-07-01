#!/usr/bin/env bash
# Agent-browser regression for VAL-ADMIN-022 category removal fix.
# Prerequisites: server (4000) and client (4100) services are running and healthy.
# Usage: bash client/e2e/admin-category-remove.sh

set -euo pipefail

SESSION="${AGENT_BROWSER_SESSION:-2028c382f546}"
BASE_URL="${CLIENT_URL:-http://localhost:4100}"
API_URL="${SERVER_URL:-http://localhost:4000}"
PASSCODE="${HOST_PASSCODE:-jeopardy}"

unset FACTORY_DESKTOP_CDP_PORT AGENT_BROWSER_CDP AGENT_BROWSER_SESSION

AB="agent-browser --session ${SESSION}"

echo "=== Opening /admin ==="
${AB} open "${BASE_URL}/admin"
sleep 1

echo "=== Authenticating ==="
${AB} click '#host-passcode'
${AB} type '#host-passcode' "${PASSCODE}"
sleep 1
${AB} click 'button[type="submit"]'
sleep 3

echo "=== Creating a new board ==="
${AB} click 'button:has-text("Create New Board")'

echo "=== Checking elementFromPoint on Remove button (mid-viewport) ==="
${AB} eval '
(() => {
  const btn = document.querySelector("#cat-title-JEOPARDY-0 + div button[aria-label=\"Remove category\"]");
  if (!btn) throw new Error("Remove button not found");
  const rect = btn.getBoundingClientRect();
  const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (el !== btn) throw new Error(`elementFromPoint resolved to ${el?.getAttribute("aria-label") || el?.tagName || "null"}, expected Remove category`);
  return "mid-viewport OK";
})()'

echo "=== Scrolling category header to top and rechecking elementFromPoint ==="
${AB} eval '
(() => {
  const header = document.querySelector("#cat-title-JEOPARDY-0")?.closest("[class*=\"categoryHeader\"]");
  if (!header) throw new Error("Category header not found");
  header.scrollIntoView({ behavior: "instant", block: "start" });
  const btn = document.querySelector("#cat-title-JEOPARDY-0 + div button[aria-label=\"Remove category\"]");
  const rect = btn.getBoundingClientRect();
  const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (el !== btn) throw new Error(`elementFromPoint resolved to ${el?.getAttribute("aria-label") || el?.tagName || "null"}, expected Remove category`);
  return "top-scroll OK";
})()'

echo "=== Clicking Remove and confirming delete ==="
${AB} click '#cat-title-JEOPARDY-0 + div button[aria-label="Remove category"]'
${AB} eval '
(() => {
  const dialog = document.querySelector("[role=alertdialog]");
  if (!dialog) throw new Error("Delete confirmation dialog not found");
  const style = window.getComputedStyle(dialog);
  if (style.position !== "fixed" || style.zIndex !== "20") {
    throw new Error(`Dialog is not viewport-anchored: position=${style.position}, zIndex=${style.zIndex}`);
  }
  return "dialog anchored OK";
})()'
${AB} click 'button:has-text("Delete Category")'

echo "=== Saving board ==="
${AB} click 'button:has-text("Save Board")'

echo "=== Waiting for save and verifying category count ==="
sleep 1
${AB} eval '
(() => {
  const summary = document.querySelector("p")?.textContent || "";
  if (!summary.includes("5 categories")) throw new Error(`Expected 5 categories after removal, got: ${summary}`);
  return "removal confirmed in DOM";
})()'

echo "=== Reloading and reopening board ==="
${AB} open "${BASE_URL}/admin"
sleep 1
${AB} click 'button[aria-label="Open New Board"]'
sleep 1

echo "=== Verifying persistence ==="
${AB} eval '
(() => {
  const summary = document.querySelector("p")?.textContent || "";
  if (!summary.includes("5 categories")) throw new Error(`Expected 5 categories after reload, got: ${summary}`);
  return "persistence OK";
})()'

echo "=== Regression passed ==="
