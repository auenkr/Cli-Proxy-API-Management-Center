import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { parseRoutingStrategy, useVisualConfig } from '../src/hooks/useVisualConfig';

describe('visual config weighted routing strategy', () => {
  test('recognizes the weighted-round-robin backend value', () => {
    expect(parseRoutingStrategy('weighted-round-robin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('weightedroundrobin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('wrr')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('fill-first')).toBe('fill-first');
    expect(parseRoutingStrategy('fillfirst')).toBe('fill-first');
    expect(parseRoutingStrategy('ff')).toBe('fill-first');
    for (const alias of ['soonest-reset', 'soonestreset', 'sr']) {
      expect(parseRoutingStrategy(alias)).toBe('soonest-reset');
    }
    expect(parseRoutingStrategy(undefined)).toBe('round-robin');
  });

  test('writes weighted-round-robin without coercing it to round-robin', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.setVisualValues({ routingStrategy: 'weighted-round-robin' });
        setPhase(1);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml('routing:\n  strategy: round-robin\n')
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const result = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(parseYaml(result)).toEqual({ routing: { strategy: 'weighted-round-robin' } });
  });
});
test('writes soonest-reset without coercing it to round-robin', () => {
  function Harness() {
    const visualConfig = useVisualConfig();
    const [phase, setPhase] = useState(0);

    if (phase === 0) {
      visualConfig.setVisualValues({ routingStrategy: 'soonest-reset' });
      setPhase(1);
    } else {
      return createElement(
        'pre',
        null,
        visualConfig.applyVisualChangesToYaml('routing:\n  strategy: round-robin\n')
      );
    }

    return null;
  }

  const markup = renderToStaticMarkup(createElement(Harness));
  const result = markup.slice('<pre>'.length, -'</pre>'.length);

  expect(parseYaml(result)).toEqual({ routing: { strategy: 'soonest-reset' } });
});

test('unrelated visual changes preserve a loaded soonest-reset strategy', () => {
  const yaml = 'routing:\n  strategy: soonest-reset\n  retry: {request-retry: 3}\n';
  function Harness() {
    const visual = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) {
      visual.loadVisualValuesFromYaml(yaml);
      setPhase(1);
    } else if (phase === 1) {
      visual.setVisualValues({ requestRetry: '4' });
      setPhase(2);
    } else {
      return createElement('pre', null, visual.applyVisualChangesToYaml(yaml));
    }
    return null;
  }
  const markup = renderToStaticMarkup(createElement(Harness));
  const result = parseYaml(markup.slice('<pre>'.length, -'</pre>'.length));
  expect(result.routing.strategy).toBe('soonest-reset');
  expect(result.routing.retry['request-retry']).toBe(4);
});
