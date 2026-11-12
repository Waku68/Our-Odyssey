// Our Odyssey の設定。
// SUPABASE_URL と SUPABASE_ANON_KEY が空のあいだは「お試しモード」で動き、
// データはこの端末のブラウザにだけ保存されます。
export const CONFIG = {
  START_DATE: '2023-01-28',      // 付き合った日
  SUPABASE_URL: 'https://izihmakuwfhjwcmuhdmo.supabase.co',              // 例: https://xxxx.supabase.co
  SUPABASE_ANON_KEY: 'sb_publishable_MxVP0_mfZx73z3YGQKw_Mw_vHkaoE4S',         // Supabase の publishable key（公開して大丈夫な方）
  VAPID_PUBLIC_KEY: '',          // 通知用の公開鍵（tools/vapid.html で作る）
};
