import { expect, test } from 'bun:test';
import { parse } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';

test('client model restrictions load and save independently from client keys', () => {
  const yaml = 'access:\n  api-keys: [client]\n  api-key-models:\n    client: [model-a]\n';
  const loaded = runVisualConfig(yaml, []);
  expect(loaded.visualValues.apiKeyModels).toEqual({ client: ['model-a'] });
  const edited = runVisualConfig(yaml, [{ apiKeyModels: { client: [] } }]);
  expect(parse(edited.applyVisualChangesToYaml(yaml)).access).toEqual({
    'api-keys': ['client'],
    'api-key-models': { client: [] },
  });
  const unrestricted = runVisualConfig(yaml, [{ apiKeyModels: {} }]);
  expect(parse(unrestricted.applyVisualChangesToYaml(yaml)).access['api-key-models']).toEqual({});
});
