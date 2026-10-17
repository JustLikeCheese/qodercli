import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { serveSite } from './adapter.mjs';
import { handleProfile } from './profile.mjs';
Deno.serve(serveSite(handleProfile, { createClient, env: (name: string) => Deno.env.get(name) }));
