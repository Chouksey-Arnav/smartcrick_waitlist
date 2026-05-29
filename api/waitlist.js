/**
 * SmartCrick Waitlist — Vercel Serverless API
 * POST /api/waitlist  → join waitlist
 * GET  /api/waitlist  → stats (count, top referrers)
 *
 * SETUP:
 *   1. Create Supabase project → supabase.com
 *   2. Run the SQL schema in Supabase SQL editor (see below)
 *   3. npm install @supabase/supabase-js resend
 *   4. Add env vars in Vercel dashboard:
 *        SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY, SITE_URL
 *
 * SUPABASE SCHEMA:
 * ─────────────────────────────────────────────────────────────────
 *   create table waitlist (
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
 *   create index on waitlist(email);
 *   create index on waitlist(ref_code);
 *   create index on waitlist(referrals desc);
 *   alter table waitlist enable row level security;
 *   create policy "Allow insert" on waitlist for insert to anon with check (true);
 *   create policy "Allow select" on waitlist for select to anon using (true);
 * ─────────────────────────────────────────────────────────────────
 */

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const SITE_URL = process.env.SITE_URL || 'https://smartcricai.vercel.app';

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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { count } = await supabase
        .from('waitlist').select('*', { count: 'exact', head: true });
      const { data: topReferrers } = await supabase
        .from('waitlist').select('name, referrals')
        .order('referrals', { ascending: false }).limit(10).gt('referrals', 0);
      return res.status(200).json({ count: count || 0, topReferrers: topReferrers || [] });
    } catch (err) {
      return res.status(500).json({ error: 'Stats unavailable' });
    }
  }

  if (req.method === 'POST') {
    const { name, email, role, level, referredBy } = req.body || {};

    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });

    const { data: existing } = await supabase
      .from('waitlist').select('id, position, ref_code')
      .eq('email', email.toLowerCase().trim()).maybeSingle();

    if (existing) {
      return res.status(200).json({ position: existing.position, refCode: existing.ref_code, alreadyJoined: true });
    }

    const { count: currentCount } = await supabase
      .from('waitlist').select('*', { count: 'exact', head: true });

    const position = (currentCount || 0) + 1;
    const refCode = genRefCode();

    const { error: insertErr } = await supabase.from('waitlist').insert({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role: role || null,
      level: level || null,
      ref_code: refCode,
      referred_by: referredBy || null,
      position
    });

    if (insertErr) {
      console.error('Insert error:', insertErr);
      return res.status(500).json({ error: 'Could not save' });
    }

    if (referredBy) {
      const { data: referrer } = await supabase
        .from('waitlist').select('id, referrals, position')
        .eq('ref_code', referredBy).maybeSingle();
      if (referrer) {
        await supabase.from('waitlist').update({
          referrals: (referrer.referrals || 0) + 1,
          position: Math.max(1, (referrer.position || position) - 5)
        }).eq('id', referrer.id);
      }
    }

    if (resend) {
      try {
        const { subject, html } = buildConfirmationEmail(name, position, refCode);
        await resend.emails.send({
          from: 'SmartCrick AI <noreply@smartcrickai.com>',
          to: email, subject, html
        });
      } catch (emailErr) {
        console.error('Email failed:', emailErr);
      }
    }

    return res.status(201).json({ position, refCode });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
