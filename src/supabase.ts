import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  "https://dhbdgmuuciwosiwpznrs.supabase.co";

const SUPABASE_ANON =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoYmRnbXV1Y2l3b3Npd3B6bnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA2ODM3ODQsImV4cCI6MjA2NjI1OTc4NH0.Qh9g4FWSYKZcOOYm7WJeJyv1QgI2r5ZDn7CcU3oT7gs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
