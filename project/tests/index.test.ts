import { describe, it, expect } from 'vitest';
import {
  parseSection,
  parseKeyValue,
  isComment,
  parseIni,
  serializeIni,
  type IniData,
} from '../src/index';

describe('parseSection', () => {
  it('should parse a valid section header', () => {
    expect(parseSection('[database]')).toBe('database');
  });

  it('should parse section header with spaces inside brackets', () => {
    expect(parseSection('[ database ]')).toBe('database');
  });

  it('should parse section header with leading/trailing whitespace', () => {
    expect(parseSection('  [server]  ')).toBe('server');
  });

  it('should return null for non-section lines', () => {
    expect(parseSection('key=value')).toBeNull();
    expect(parseSection('# comment')).toBeNull();
    expect(parseSection('')).toBeNull();
  });

  it('should return null for malformed section headers', () => {
    expect(parseSection('[unclosed')).toBeNull();
    expect(parseSection('unopened]')).toBeNull();
    expect(parseSection('[]')).toBeNull();
  });

  it('should handle section names with special characters', () => {
    expect(parseSection('[section.name]')).toBe('section.name');
    expect(parseSection('[section-name]')).toBe('section-name');
    expect(parseSection('[section_name]')).toBe('section_name');
  });
});

describe('parseKeyValue', () => {
  it('should parse a simple key=value pair', () => {
    expect(parseKeyValue('host=localhost')).toEqual({ key: 'host', value: 'localhost' });
  });

  it('should handle values with equals signs', () => {
    expect(parseKeyValue('equation=a=b+c')).toEqual({ key: 'equation', value: 'a=b+c' });
  });

  it('should trim whitespace around key and value', () => {
    expect(parseKeyValue('  key  =  value  ')).toEqual({ key: 'key', value: 'value' });
  });

  it('should return null for lines without equals sign', () => {
    expect(parseKeyValue('no equals here')).toBeNull();
    expect(parseKeyValue('[section]')).toBeNull();
  });

  it('should return null for empty key', () => {
    expect(parseKeyValue('=value')).toBeNull();
    expect(parseKeyValue('  =value')).toBeNull();
  });

  it('should handle empty value', () => {
    expect(parseKeyValue('key=')).toEqual({ key: 'key', value: '' });
    expect(parseKeyValue('key=  ')).toEqual({ key: 'key', value: '' });
  });

  it('should handle quoted values', () => {
    expect(parseKeyValue('path="C:\\Program Files"')).toEqual({ key: 'path', value: 'C:\\Program Files' });
    expect(parseKeyValue("name='John Doe'")).toEqual({ key: 'name', value: 'John Doe' });
  });

  it('should preserve internal whitespace in values', () => {
    expect(parseKeyValue('message=hello world')).toEqual({ key: 'message', value: 'hello world' });
  });
});

describe('isComment', () => {
  it('should identify semicolon comments', () => {
    expect(isComment('; this is a comment')).toBe(true);
    expect(isComment(';comment')).toBe(true);
  });

  it('should identify hash comments', () => {
    expect(isComment('# this is a comment')).toBe(true);
    expect(isComment('#comment')).toBe(true);
  });

  it('should handle comments with leading whitespace', () => {
    expect(isComment('  ; indented comment')).toBe(true);
    expect(isComment('\t# tab comment')).toBe(true);
  });

  it('should not identify non-comments', () => {
    expect(isComment('key=value')).toBe(false);
    expect(isComment('[section]')).toBe(false);
    expect(isComment('not a comment ; inline')).toBe(false);
  });

  it('should handle empty strings and whitespace-only lines', () => {
    expect(isComment('')).toBe(false);
    expect(isComment('   ')).toBe(false);
    expect(isComment('\t')).toBe(false);
  });
});

describe('parseIni', () => {
  it('should parse a simple INI file with one section', () => {
    const ini = `
[database]
host=localhost
port=3306
`;
    const result = parseIni(ini);
    expect(result).toEqual({
      database: {
        host: 'localhost',
        port: '3306',
      },
    });
  });

  it('should parse multiple sections', () => {
    const ini = `
[server]
host=example.com

[database]
host=db.example.com
`;
    const result = parseIni(ini);
    expect(result).toEqual({
      server: { host: 'example.com' },
      database: { host: 'db.example.com' },
    });
  });

  it('should ignore comments', () => {
    const ini = `
; This is a comment
[config]
# Another comment
key=value
; inline style not supported
`;
    const result = parseIni(ini);
    expect(result).toEqual({
      config: { key: 'value' },
    });
  });

  it('should handle global keys without section', () => {
    const ini = `
global_key=global_value
[section]
key=value
`;
    const result = parseIni(ini);
    expect(result).toEqual({
      '': { global_key: 'global_value' },
      section: { key: 'value' },
    });
  });

  it('should handle empty input', () => {
    expect(parseIni('')).toEqual({});
    expect(parseIni('   \n\n  ')).toEqual({});
  });

  it('should handle duplicate keys (last value wins)', () => {
    const ini = `
[section]
key=first
key=second
`;
    const result = parseIni(ini);
    expect(result).toEqual({
      section: { key: 'second' },
    });
  });

  it('should handle Windows-style line endings (CRLF)', () => {
    const ini = '[section]\r\nkey=value\r\n';
    const result = parseIni(ini);
    expect(result).toEqual({
      section: { key: 'value' },
    });
  });

  it('should skip empty lines', () => {
    const ini = `
[section]

key1=value1

key2=value2

`;
    const result = parseIni(ini);
    expect(result).toEqual({
      section: { key1: 'value1', key2: 'value2' },
    });
  });
});

describe('serializeIni', () => {
  it('should serialize a simple INI structure', () => {
    const data: IniData = {
      database: {
        host: 'localhost',
        port: '3306',
      },
    };
    const result = serializeIni(data);
    expect(result).toBe('[database]\nhost=localhost\nport=3306\n');
  });

  it('should serialize multiple sections', () => {
    const data: IniData = {
      server: { host: 'example.com' },
      database: { host: 'db.example.com' },
    };
    const result = serializeIni(data);
    expect(result).toContain('[server]');
    expect(result).toContain('[database]');
    expect(result).toContain('host=example.com');
    expect(result).toContain('host=db.example.com');
  });

  it('should handle global section (empty string key)', () => {
    const data: IniData = {
      '': { global: 'value' },
      section: { key: 'value' },
    };
    const result = serializeIni(data);
    expect(result).toMatch(/^global=value\n/);
    expect(result).toContain('[section]');
  });

  it('should handle empty data', () => {
    expect(serializeIni({})).toBe('');
  });

  it('should handle empty sections', () => {
    const data: IniData = {
      empty: {},
    };
    const result = serializeIni(data);
    expect(result).toBe('[empty]\n');
  });

  it('should preserve values with special characters', () => {
    const data: IniData = {
      paths: {
        dir: 'C:\\Program Files',
        url: 'https://example.com?a=1&b=2',
      },
    };
    const result = serializeIni(data);
    expect(result).toContain('dir=C:\\Program Files');
    expect(result).toContain('url=https://example.com?a=1&b=2');
  });
});

describe('roundtrip', () => {
  it('should parse and serialize back to equivalent INI', () => {
    const original = `[database]
host=localhost
port=3306
`;
    const parsed = parseIni(original);
    const serialized = serializeIni(parsed);
    const reparsed = parseIni(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it('should handle complex INI with multiple sections', () => {
    const original = `[server]
host=example.com
port=8080

[database]
host=db.local
user=admin
password=secret
`;
    const parsed = parseIni(original);
    const serialized = serializeIni(parsed);
    const reparsed = parseIni(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it('should handle global keys in roundtrip', () => {
    const original = `global=value

[section]
key=value
`;
    const parsed = parseIni(original);
    const serialized = serializeIni(parsed);
    const reparsed = parseIni(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it('should handle values with equals signs in roundtrip', () => {
    const original = `[math]
equation=a=b+c
`;
    const parsed = parseIni(original);
    const serialized = serializeIni(parsed);
    const reparsed = parseIni(serialized);
    expect(reparsed).toEqual(parsed);
  });
});
