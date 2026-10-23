// Approved Policy Source for PromiseLoop AI
// Source of truth for retailer and customer support policies.
// All AI and rule-based responses regarding returns, refunds, replacements,
// delivery issues, and SLAs must ground their answers in these verified policies.

const fs = require('fs');
const path = require('path');

const DEFAULT_POLICIES = {
  returnsAndReplacements: {
    title: 'Returns & Replacements Policy',
    returnWindowDays: 30,
    summary: 'Customers may request a replacement or return within 30 days of confirmed delivery for items that arrived damaged, defective, incomplete, or incorrect.',
    requirements: [
      'Report the issue within 30 days of the delivery date.',
      'Provide clear photographic evidence of damage, defects, or incorrect items.',
      'Retain original packaging and shipping labels until the claim is reviewed.'
    ],
    replacementDispatch: 'Standard replacements are dispatched within 1-2 business days once photographic evidence is verified by an agent.'
  },
  damagedItems: {
    title: 'Damaged in Transit Policy',
    summary: 'Items damaged during transit are eligible for an immediate replacement or full refund without requiring return of the damaged unit if return shipping poses a hazard.',
    evidenceRequired: 'At least 1 photo showing the damaged product and 1 photo showing the exterior shipping box with carrier label.',
    timeframe: 'Must be reported within 7 days of delivery for expedited carrier claim processing.'
  },
  missingItems: {
    title: 'Missing Items or Incomplete Orders',
    summary: 'If an item is missing from a multi-item package or parts are absent from the product box, we will ship the missing items immediately or issue a partial refund.',
    verification: 'Customer should verify all packaging compartments and packing slips before submitting. Carrier package weight is cross-checked by support.'
  },
  wrongItems: {
    title: 'Incorrect Item Received',
    summary: 'If the wrong item is delivered, a prepaid return shipping label will be generated, and the correct item will be dispatched immediately.',
    evidenceRequired: 'Photo of the barcode or model number on the received product.'
  },
  refundProcessing: {
    title: 'Refund Processing & Timelines',
    summary: 'Approved refunds are credited to the original payment method within 3 to 5 business days.',
    conditions: 'Refunds cannot be issued to alternative payment methods or third-party accounts for fraud prevention.'
  },
  deliveryDelaysAndLoss: {
    title: 'Delivery Delays & Lost Packages',
    summary: 'A shipment is considered lost in transit if tracking has not updated for 5 consecutive business days past the original estimated delivery date.',
    resolution: 'Automatic replacement shipment or full refund at customer choice.'
  },
  safetyAndHazards: {
    title: 'Safety Hazards, Battery Overheating & Product Recalls',
    summary: 'Any report involving battery overheating, fire, smoke, electrical shock, chemical leakage, or physical injury is classified as Critical Safety Priority.',
    protocol: 'Do NOT return damaged batteries or hazardous materials by mail. First response is required within 1 hour. Immediate escalation to human safety team.'
  }
};

function getApprovedPolicies() {
  const customPath = process.env.POLICY_SOURCE_PATH;
  if (customPath) {
    try {
      const resolved = path.resolve(customPath);
      if (fs.existsSync(resolved)) {
        return JSON.parse(fs.readFileSync(resolved, 'utf8'));
      }
    } catch (e) {
      console.warn(`[PolicySource] Failed to load custom policy at ${customPath}: ${e.message}`);
    }
  }
  return DEFAULT_POLICIES;
}

function isPolicySourceAvailable() {
  return true;
}

function searchPolicies(query) {
  const q = String(query || '').toLowerCase();
  const policies = getApprovedPolicies();
  const matches = [];

  for (const [key, pol] of Object.entries(policies)) {
    const hay = `${pol.title} ${pol.summary} ${JSON.stringify(pol)}`.toLowerCase();
    if (q.split(/\s+/).some(term => term.length > 2 && hay.includes(term))) {
      matches.push({ key, ...pol });
    }
  }

  return matches.length > 0 ? matches : Object.entries(policies).map(([key, pol]) => ({ key, ...pol }));
}

function getPolicyContextText() {
  const policies = getApprovedPolicies();
  return Object.values(policies)
    .map(p => `• ${p.title}: ${p.summary} ${p.requirements ? 'Requirements: ' + p.requirements.join('; ') : ''} ${p.conditions || ''} ${p.protocol || ''}`)
    .join('\n');
}

module.exports = {
  getApprovedPolicies,
  isPolicySourceAvailable,
  searchPolicies,
  getPolicyContextText,
  DEFAULT_POLICIES
};
