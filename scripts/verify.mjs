import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { DEFAULT_SETTINGS } from '../extension/src/services/storageService.js';
import { buildImageApiPayload, findImageModelConfig } from '../extension/src/data/imageModels.js';
import { buildCustomImageRequest } from '../extension/src/services/imageRequestBuilder.js';
import { getOutputSize, mapSizeForOpenAIImages } from '../extension/src/utils/size.js';

const root = process.cwd();

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) walk(rel, filter, out);
    else if (!filter || filter(rel)) out.push(rel);
  }
  return out;
}

test('all extension javascript has valid syntax', () => {
  for (const file of walk('extension/src', (rel) => rel.endsWith('.js'))) {
    execFileSync('node', ['--check', file], { cwd: root, stdio: 'pipe' });
  }
});

test('manifest json parses', () => {
  JSON.parse(read('extension/manifest.json'));
});

test('output size presets', () => {
  const cases = [
    ['1k', '1:1', '1080x1080'],
    ['1k', '16:9', '1920x1080'],
    ['1k', '9:16', '1080x1920'],
    ['2k', '16:9', '2560x1440'],
    ['2k', '9:16', '1440x2560'],
    ['4k', '16:9', '3840x2160'],
    ['4k', '9:16', '2160x3840']
  ];

  for (const [resolutionPreset, aspectRatio, expected] of cases) {
    const size = getOutputSize({ sizeMode: 'preset', aspectRatio, resolutionPreset });
    assert.equal(size.size, expected);
  }
});

test('OpenAI-compatible size mapping', () => {
  assert.equal(mapSizeForOpenAIImages('1080x1080'), '1024x1024');
  assert.equal(mapSizeForOpenAIImages('1920x1080'), '1536x1024');
  assert.equal(mapSizeForOpenAIImages('1080x1920'), '1024x1536');
  assert.equal(mapSizeForOpenAIImages('3840x2160'), '1536x1024');
});

test('Grsai v2 payload builder', () => {
  const outputSize = getOutputSize({ sizeMode: 'preset', aspectRatio: '1:1', resolutionPreset: '1k' });
  const imagePayload = buildImageApiPayload({
    model: 'gpt-image-2',
    prompt: 'test',
    outputSize,
    channel: 'image',
    images: [],
    settings: { imageApi: DEFAULT_SETTINGS.imageApi }
  }).payload;
  assert.equal(imagePayload.aspectRatio, '1080x1080');
  assert.equal(imagePayload.replyType, 'json');
  assert.ok(!('size' in imagePayload));

  const nanoPayload = buildImageApiPayload({
    model: 'nano-banana-2',
    prompt: 'test',
    outputSize: getOutputSize({ sizeMode: 'preset', aspectRatio: '16:9', resolutionPreset: '2k' }),
    channel: 'nano-banana',
    images: [],
    settings: { imageApi: { ...DEFAULT_SETTINGS.imageApi, model: 'nano-banana-2' } }
  }).payload;
  assert.equal(nanoPayload.aspectRatio, '16:9');
  assert.equal(nanoPayload.imageSize, '2K');
  assert.equal(nanoPayload.replyType, 'json');
});

test('custom image request template and auth modes', () => {
  const outputSize = getOutputSize({ sizeMode: 'preset', aspectRatio: '16:9', resolutionPreset: '2k' });
  const baseApi = {
    ...DEFAULT_SETTINGS.imageApi,
    baseUrl: 'https://example.com',
    endpoint: '/gen/{{model}}',
    apiKey: 'KEY',
    model: 'my-custom-model',
    sizeFormat: '*',
    custom: {
      ...DEFAULT_SETTINGS.imageApi.custom,
      requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}","dash":"{{dashscopeSize}}","w":{{width}},"h":{{height}},"ratio":"{{aspectRatio}}","preset":"{{resolutionPreset}}","mode":"{{sizeMode}}","count":{{count}}}'
    }
  };

  const req = buildCustomImageRequest({ api: baseApi, prompt: 'hello', outputSize, count: 1, mode: 'standard' });
  assert.equal(req.url, 'https://example.com/gen/my-custom-model');
  assert.equal(req.body, '{"model":"my-custom-model","prompt":"hello","size":"2560x1440","dash":"2560*1440","w":2560,"h":1440,"ratio":"16:9","preset":"2k","mode":"preset","count":1}');

  const authCases = [
    ['query-key', { url: 'https://example.com/gen/my-custom-model?api_key=KEY', header: null }],
    ['bearer', { url: 'https://example.com/gen/my-custom-model', header: ['Authorization', 'Bearer KEY'] }],
    ['x-api-key', { url: 'https://example.com/gen/my-custom-model', header: ['x-api-key', 'KEY'] }],
    ['custom-header', { url: 'https://example.com/gen/my-custom-model', header: ['X-Custom-Key', 'KEY'] }],
    ['none', { url: 'https://example.com/gen/my-custom-model', header: null }]
  ];

  for (const [authType, expected] of authCases) {
    const api = {
      ...baseApi,
      custom: {
        ...baseApi.custom,
        authType,
        customHeaderName: 'X-Custom-Key',
        queryKeyName: 'api_key'
      }
    };
    const built = buildCustomImageRequest({ api, prompt: 'hello', outputSize });
    assert.equal(built.url, expected.url);
    if (expected.header) assert.equal(built.headers[expected.header[0]], expected.header[1]);
    if (!expected.header && authType !== 'query-key') {
      assert.ok(!built.headers.Authorization);
      assert.ok(!built.headers['x-api-key']);
      assert.ok(!built.headers['X-Custom-Key']);
    }
  }
});

test('image test provider routing rules', () => {
  const outputSize = getOutputSize(DEFAULT_SETTINGS.imageApi);
  const defaultModel = findImageModelConfig(DEFAULT_SETTINGS.imageApi.model);
  assert.equal(DEFAULT_SETTINGS.imageApi.type, 'custom-image');
  assert.equal(defaultModel?.channel, 'image');

  const grsaiPayload = buildImageApiPayload({
    model: DEFAULT_SETTINGS.imageApi.model,
    prompt: 'test',
    outputSize,
    channel: defaultModel.channel,
    images: [],
    settings: { imageApi: DEFAULT_SETTINGS.imageApi }
  }).payload;
  assert.equal(grsaiPayload.aspectRatio, '1080x1080');

  const openAiApi = {
    ...DEFAULT_SETTINGS.imageApi,
    type: 'openai-compatible-image',
    sizeFormat: 'openai-mapped',
    model: 'gpt-image-2'
  };
  assert.equal(openAiApi.type, 'openai-compatible-image');
  assert.equal(mapSizeForOpenAIImages(outputSize.size), '1024x1024');

  const customApi = {
    ...DEFAULT_SETTINGS.imageApi,
    model: 'my-custom-model',
    endpoint: '/custom',
    custom: { ...DEFAULT_SETTINGS.imageApi.custom, requestTemplate: '{"size":"{{size}}"}' }
  };
  assert.equal(findImageModelConfig(customApi.model), null);
  assert.equal(buildCustomImageRequest({ api: customApi, prompt: 'test', outputSize }).body, '{"size":"1080x1080"}');
});

function idsFromHtml(rel) {
  return new Set([...read(rel).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
}

function idsFromJs(rel, includeDollar) {
  const text = read(rel);
  const ids = new Set();
  for (const match of text.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) ids.add(match[1]);
  for (const match of text.matchAll(/on\(['"]([^'"]+)['"]\s*,/g)) ids.add(match[1]);
  if (includeDollar) {
    for (const match of text.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) ids.add(match[1]);
  }
  return ids;
}

test('Options and Side Panel DOM ids match JavaScript bindings', () => {
  const pairs = [
    ['extension/src/options/options.js', 'extension/src/options/options.html', false],
    ['extension/src/sidepanel/sidepanel.js', 'extension/src/sidepanel/sidepanel.html', true]
  ];

  for (const [js, html, includeDollar] of pairs) {
    const htmlIds = idsFromHtml(html);
    const jsIds = idsFromJs(js, includeDollar);
    const missing = [...jsIds].filter((id) => !htmlIds.has(id)).sort();
    assert.deepEqual(missing, [], `${js} missing ids: ${missing.join(', ')}`);
  }
});

test('HTML files do not contain common corruption markers', () => {
  for (const file of ['extension/src/options/options.html', 'extension/src/sidepanel/sidepanel.html']) {
    const text = read(file);
    assert.equal(text.includes('\uFFFD'), false);
    assert.equal(/\?\/(?:button|option|span|label|h[1-6]|p|textarea|div|footer)>/.test(text), false);
  }
});

console.log('verify complete');
