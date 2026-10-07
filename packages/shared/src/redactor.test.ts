import { describe, expect, it } from 'vitest';
import { redact, redactString } from './redactor.js';

describe('redactor', () => {
  it('redacts secret fields recursively', () => {
    expect(
      redact({ authorization: 'abc', nested: { npmAuthToken: 'def', safe: 'visible' } }),
    ).toEqual({
      authorization: '[REDACTED]',
      nested: { npmAuthToken: '[REDACTED]', safe: 'visible' },
    });
  });

  it('redacts bearer values and URL passwords', () => {
    expect(redactString('Bearer abc.def https://user:password@example.test/db')).toBe(
      'Bearer [REDACTED] https://user:[REDACTED]@example.test/db',
    );
  });

  it('keeps secret reference names while hiding values', () => {
    expect(
      redact({ requiredSecrets: ['JIRA_TOKEN'], authRef: 'hub-token', token: 'actual' }),
    ).toEqual({
      requiredSecrets: ['JIRA_TOKEN'],
      authRef: 'hub-token',
      token: '[REDACTED]',
    });
  });
});
