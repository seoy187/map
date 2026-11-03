import { createClient } from "@supabase/supabase-js";

// service role 키를 쓰므로 API 라우트에서만 가져옵니다.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
