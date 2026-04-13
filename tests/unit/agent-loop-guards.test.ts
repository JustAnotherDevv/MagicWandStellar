import { describe, it, expect } from 'vitest';
import { __loopGuardsForTests } from '../../src/agent/loop.js';

describe('agent loop retry guards', () => {
  it('treats Exit code 0 as success', () => {
    expect(__loopGuardsForTests.toolResultSucceeded('contract_build', 'STDOUT:\nok\n\nExit code: 0')).toBe(true);
  });

  it('treats non-zero exit code as failure', () => {
    expect(__loopGuardsForTests.toolResultSucceeded('contract_build', 'STDERR:\nerr\n\nExit code: 101')).toBe(false);
  });

  it('blocks retrying contract_build after failed build with no write', () => {
    const messages: any[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'b1', type: 'function', function: { name: 'contract_build', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'b1', content: 'STDERR:\ncompile fail\n\nExit code: 101' },
    ];
    expect(__loopGuardsForTests.shouldBlockRetryUntilWrite(messages, 'contract_build')).toBe(true);
  });

  it('does not block retrying contract_build after successful write_file', () => {
    const messages: any[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'b1', type: 'function', function: { name: 'contract_build', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'b1', content: 'STDERR:\ncompile fail\n\nExit code: 101' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'w1', type: 'function', function: { name: 'write_file', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'w1', content: 'Written 123 bytes to contracts/token/src/lib.rs' },
    ];
    expect(__loopGuardsForTests.shouldBlockRetryUntilWrite(messages, 'contract_build')).toBe(false);
  });
});
