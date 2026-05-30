/**
 * SmartCrick Waitlist — Vercel Serverless API
 * POST /api/waitlist  → join waitlist
 * GET  /api/waitlist  → stats (count, top referrers)
 *
 * SETUP:
 *   1. Create Supabase project → supabase.com
 *   2. Run the SQL schema in Supabase SQL editor (see below)
 *   3. In Vercel dashboard → Settings → Environment Variables, add:
 *        SUPABASE_URL            (e.g. https://xxxx.supabase.co  — NO trailing slash)
 *        SUPABASE_SERVICE_ROLE_KEY  (Settings → API → service_role key)
 *        RESEND_API_KEY          (from resend.com)
 *        SITE_URL                (your Vercel URL, e.g. https://smartcricai.vercel.app)
 *
 * SUPABASE SCHEMA — paste this in the Supabase SQL Editor and click Run:
 * ─────────────────────────────────────────────────────────────────────────
 *   create table if not exists waitlist (
 *     id           uuid default gen_random_uuid() primary key,
 *     name         text not null,
 *     email        text not null unique,
 *     role         text,
 *     level        text,
 *     ref_code     text not null unique,
 *     referred_by  text,
 *     position     integer not null,
 *     referrals    integer default 0,
 *     created_at   timestamptz default now()
 *   );
 *   create index if not exists waitlist_email_idx     on waitlist(email);
 *   create index if not exists waitlist_ref_code_idx  on waitlist(ref_code);
 *   create index if not exists waitlist_referrals_idx on waitlist(referrals desc);
 * ─────────────────────────────────────────────────────────────────────────
 * NOTE: No RLS needed — we use the service_role key server-side which
 *       bypasses RLS entirely. Do NOT use the anon key here.
 */

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

// ── Sanitise env vars ────────────────────────────────────────
const SUPABASE_URL      = (process.env.SUPABASE_URL              || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY      = (process.env.SUPABASE_SERVICE_ROLE_KEY  || '').trim();
const RESEND_KEY        = (process.env.RESEND_API_KEY             || '').trim();
const SITE_URL          = (process.env.SITE_URL || 'https://smartcricai.vercel.app').trim().replace(/\/+$/, '');

// ── Startup validation ───────────────────────────────────────
const missingVars = [];
if (!SUPABASE_URL)  missingVars.push('SUPABASE_URL');
if (!SUPABASE_KEY)  missingVars.push('SUPABASE_SERVICE_ROLE_KEY');
if (missingVars.length) {
  console.error(`[SmartCrick API] FATAL: Missing env vars: ${missingVars.join(', ')}`);
  console.error('[SmartCrick API] Add these in Vercel → Settings → Environment Variables');
}

// ── Clients ──────────────────────────────────────────────────
// Service role key bypasses RLS — safe here because this is server-side only.
// Never use service_role key in client-side / browser code.
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

// ── Helpers ──────────────────────────────────────────────────
function genRefCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'SC';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function buildConfirmationEmail(name, position, refCode) {
  const refUrl = `${SITE_URL}?ref=${refCode}`;
  return {
    subject: `You're #${position.toLocaleString()} on the SmartCrick AI waitlist! 🏏`,
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0a0c0f;font-family:'Helvetica Neue',Arial,sans-serif"><div style="max-width:560px;margin:40px auto;padding:0 20px"><div style="background:#111318;border-radius:16px;border:1px solid rgba(55,62,72,0.9);overflow:hidden"><div style="height:3px;background:linear-gradient(90deg,#16a34a,#0d9488,#16a34a)"></div><div style="padding:40px 32px;text-align:center"><div style="font-size:48px;margin-bottom:12px">🏏</div><h1 style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#4ade80;margin:0 0 8px">SmartCrick AI</h1><h2 style="font-size:32px;font-weight:800;color:#f0fdf4;margin:0 0 6px;letter-spacing:-0.01em">You're on the list!</h2><p style="font-size:14px;color:#8b949e;margin:0 0 28px">Your waitlist position</p><div style="background:#0a0c0f;border-radius:12px;border:1px solid rgba(22,163,74,0.3);padding:24px;margin-bottom:28px;display:inline-block;min-width:160px"><div style="font-size:60px;font-weight:800;color:#4ade80;line-height:1;letter-spacing:-0.02em">#${position.toLocaleString()}</div></div><p style="font-size:15px;color:#c9d1d9;line-height:1.65;margin:0 0 28px">Hi ${name}! We'll email you the moment your spot opens. Refer friends using the link below to move up the queue.</p></div><div style="padding:0 32px 32px"><div style="background:#161b22;border-radius:12px;border:1px solid rgba(55,62,72,0.9);padding:20px;margin-bottom:20px"><p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#484f58;margin:0 0 10px">Your referral link</p><div style="background:#0a0c0f;border-radius:8px;border:1px solid rgba(55,62,72,0.9);padding:12px 14px;font-family:monospace;font-size:13px;color:#8b949e;word-break:break-all;margin-bottom:12px">${refUrl}</div><a href="${refUrl}" style="display:block;background:#16a34a;color:#fff;text-align:center;padding:13px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.02em">Share Your Link →</a></div><p style="font-size:12px;color:#484f58;text-align:center;margin:0">© 2025 SmartCrick AI</p></div></div></div></body></html>`
  };
}

// ── Main handler ─────────────────────────────────────────────
module.exports = async function handler(req, res) {

  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Guard: supabase not initialised
  if (!supabase) {
    return res.status(500).json({
      error: 'Server misconfiguration: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them in Vercel → Settings → Environment Variables.'
    });
  }

  // ── GET — stats ─────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { count, error: countErr } = await supabase
        .from('waitlist')
        .select('*', { count: 'exact', head: true });

      if (countErr) throw countErr;

      const { data: topReferrers, error: topErr } = await supabase
        .from('waitlist')
        .select('name, referrals, role')
        .order('referrals', { ascending: false })
        .limit(10)
        .gt('referrals', 0);

      if (topErr) throw topErr;

      return res.status(200).json({ count: count || 0, topReferrers: topReferrers || [] });
    } catch (err) {
      console.error('[SmartCrick API] GET error:', err.message);
      return res.status(500).json({ error: 'Stats unavailable', detail: err.message });
    }
  }

  // ── POST — join ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, email, role, level, referredBy } = req.body || {};

    // Validate
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    try {
      // Check for duplicate
      const { data: existing, error: dupErr } = await supabase
        .from('waitlist')
        .select('id, position, ref_code')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (dupErr) throw dupErr;

      if (existing) {
        return res.status(200).json({
          position:     existing.position,
          refCode:      existing.ref_code,
          alreadyJoined: true
        });
      }

      // Get current count for position
      const { count: currentCount, error: countErr } = await supabase
        .from('waitlist')
        .select('*', { count: 'exact', head: true });

      if (countErr) throw countErr;

      const position = (currentCount || 0) + 1;
      const refCode  = genRefCode();

      // Insert new signup
      const { error: insertErr } = await supabase.from('waitlist').insert({
        name:        String(name).trim(),
        email:       cleanEmail,
        role:        role  || null,
        level:       level || null,
        ref_code:    refCode,
        referred_by: referredBy || null,
        position
      });

      if (insertErr) {
        console.error('[SmartCrick API] Insert error:', insertErr.message);
        throw insertErr;
      }

      // Credit referrer (service role key means no RLS issues)
      if (referredBy && String(referredBy).trim()) {
        const { data: referrer, error: refErr } = await supabase
          .from('waitlist')
          .select('id, referrals, position')
          .eq('ref_code', String(referredBy).trim())
          .maybeSingle();

        if (!refErr && referrer) {
          const { error: updateErr } = await supabase
            .from('waitlist')
            .update({
              referrals: (referrer.referrals || 0) + 1,
              position:  Math.max(1, (referrer.position || position) - 5)
            })
            .eq('id', referrer.id);

          if (updateErr) {
            console.error('[SmartCrick API] Referrer update error:', updateErr.message);
          }
        }
      }

      // Send confirmation email (non-fatal if it fails)
      if (resend) {
        try {
          const { subject, html } = buildConfirmationEmail(String(name).trim(), position, refCode);
          await resend.emails.send({
            from:    'SmartCrick AI <noreply@smartcrickai.com>',
            to:      cleanEmail,
            subject,
            html
          });
        } catch (emailErr) {
          console.error('[SmartCrick API] Email error (non-fatal):', emailErr.message);
        }
      }

      return res.status(201).json({ position, refCode });

    } catch (err) {
      console.error('[SmartCrick API] POST error:', err.message);
      return res.status(500).json({ error: 'Could not save your signup', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
