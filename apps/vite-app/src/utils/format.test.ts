import { describe, it, expect } from 'vitest';
import { formatTitle } from './format';

describe('formatTitle', () => {
  it('should return empty string for empty string', () => {
    expect(formatTitle('')).toBe('');
  });

  it('should convert underscore separated words to title case separated by space', () => {
    expect(formatTitle('hello_world')).toBe('Hello World');
    expect(formatTitle('my_first_test')).toBe('My First Test');
  });

  it('should handle single word correctly', () => {
    expect(formatTitle('hello')).toBe('Hello');
  });
});
