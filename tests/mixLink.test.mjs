import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))
const linkModuleUrl = moduleUrl(compile('../src/lib/mixLink.ts'))
const { normalizeMixUrl, mixLinkDetails, MIX_LINK_ERROR } = await import(linkModuleUrl)

test('optional links become NULL and old records render without a link', () => {
  for (const input of [undefined, null, '', '   ']) {
    assert.equal(normalizeMixUrl(input), null)
    assert.equal(mixLinkDetails(input), null)
  }
})

test('all normal HTTP(S) providers work without rewriting private-link tokens', () => {
  for (const url of [
    'https://drive.google.com/file/d/example/view?usp=sharing',
    'https://www.dropbox.com/scl/fi/example/mix.wav?rlkey=AbC_123&dl=0',
    'https://1drv.ms/u/s!example?e=token',
    'https://soundcloud.com/example/private-mix/s-AbCd',
    'https://example.com/mix%20one?signature=a%2Fb%3D#listen',
    'http://example.com:8080/mix',
    'HTTPS://EXAMPLE.COM/mix',
  ]) {
    assert.equal(normalizeMixUrl(` ${url} `), url)
    assert.deepEqual(mixLinkDetails(url), { url, hostname: new URL(url).hostname })
  }
})

test('malformed/unsafe schemes and URLs are rejected and never rendered', () => {
  for (const url of [
    'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com/mix',
    '//example.com/mix', 'example.com/mix', 'https://', 'http://?x',
    'https:///example.com', 'https://example.com/bad space',
    'https://example.com/line\nbreak', 'https://example.com\\evil',
    'https://user:password@example.com/mix', 'https://[broken]/mix',
  ]) {
    assert.throws(() => normalizeMixUrl(url), { message: MIX_LINK_ERROR })
    assert.equal(mixLinkDetails(url), null)
  }
})

// Exercise the actual service payloads without connecting to any database.
const coreUrl = moduleUrl(`
  export const calls = [];
  const builder = {
    select() { return this }, eq() { return this }, or() { return this },
    async limit() { return { data: [{ id: 'release-uuid' }], error: null } },
    insert(value) { calls.push({ action: 'insert', value }); return this },
    update(value) { calls.push({ action: 'update', value }); return this },
    async single() { return { data: { id: 'mix-uuid', ...calls.at(-1).value }, error: null } },
  };
  export const requireSupabase = () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }) },
    from: () => builder,
  });
`)
const { calls } = await import(coreUrl)
const serviceSource = compile('../src/lib/services/releaseMixes.ts')
  .replace("from './core'", `from '${coreUrl}'`)
  .replace("from '../mixLink'", `from '${linkModuleUrl}'`)
const { releaseMixService } = await import(moduleUrl(serviceSource))
const context = { membership: { workspace_id: 'workspace' }, member: { id: 'member', display_name: 'Test' } }

test('service creates, edits and clears links without changing approval or audio', async () => {
  const created = await releaseMixService.createVersion(context, 'legacy-release', ' Mix 1 ', ' Description ', ' https://drive.google.com/file/d/example/view ')
  assert.equal(created.mix_url, 'https://drive.google.com/file/d/example/view')
  assert.equal(created.storage_path, null)
  assert.equal(created.display_name, 'Mix 1')
  const noLink = await releaseMixService.createVersion(context, 'legacy-release', 'Mix 2', '')
  assert.equal(noLink.mix_url, null)
  await releaseMixService.updateVersion(context, 'mix-uuid', { mix_url: ' https://example.com/changed ' })
  assert.deepEqual(calls.at(-1).value, { mix_url: 'https://example.com/changed' })
  await releaseMixService.updateVersion(context, 'mix-uuid', { mix_url: '' })
  assert.deepEqual(calls.at(-1).value, { mix_url: null })
  await releaseMixService.updateVersion(context, 'mix-uuid', { approval_status: 'Approved' })
  assert.deepEqual(calls.at(-1).value, { approval_status: 'Approved' })
  const before = calls.length
  await assert.rejects(releaseMixService.createVersion(context, 'release', 'Bad', '', 'javascript:alert(1)'), { message: MIX_LINK_ERROR })
  await assert.rejects(releaseMixService.updateVersion(context, 'mix', { mix_url: 'not a url' }), { message: MIX_LINK_ERROR })
  assert.equal(calls.length, before)
})
