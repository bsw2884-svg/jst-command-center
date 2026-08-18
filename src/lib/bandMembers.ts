export const JST_WORKSPACE_ID = '10000000-0000-4000-8000-000000000001'

export const JST_BAND_MEMBERS = [
  { id: '20000000-0000-4000-8000-000000000001', slug: 'brandon', name: 'Brandon', role: 'admin' },
  { id: '20000000-0000-4000-8000-000000000002', slug: 'tyler', name: 'Tyler', role: 'member' },
  { id: '20000000-0000-4000-8000-000000000003', slug: 'danny', name: 'Danny', role: 'member' },
  { id: '20000000-0000-4000-8000-000000000004', slug: 'mike', name: 'Mike', role: 'member' },
] as const

export type JstBandMemberId = typeof JST_BAND_MEMBERS[number]['id']
