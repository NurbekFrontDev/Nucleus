import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ewgrcmswwvbtoxdxkvuv.supabase.co',
  'sb_publishable_6N8-e0r4a93yDsbl-0iyKw_kZ5e2pw0'
)

async function main() {
  const { data: items, error } = await supabase
    .from('planner_items')
    .select('id, title, repeat_rule, archived, created_at, start_date')
    .eq('archived', true)

  console.log('Archived items:', JSON.stringify(items, null, 2))
  if (error) console.error('Error:', error)
}

main()
