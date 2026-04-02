/**
 * INI Configuration File Parser
 *
 * Supports:
 * - Section headers: [section]
 * - Key-value pairs: key=value
 * - Comments: lines starting with ; or #
 * - Serialization back to INI format
 */

/**
 * Represents the parsed INI data structure.
 * Keys are section names (empty string for global section).
 * Values are objects mapping keys to string values.
 */
export type IniData = Record<string, Record<string, string>>;

/**
 * Represents a parsed key-value pair.
 */
export interface KeyValuePair {
  key: string;
  value: string;
}

/**
 * Parses a section header line and returns the section name.
 *
 * @param line - A single line from an INI file
 * @returns The section name if the line is a valid section header, null otherwise
 *
 * @example
 * parseSection('[database]') // returns 'database'
 * parseSection('[ server ]') // returns 'server'
 * parseSection('key=value')  // returns null
 */
export function parseSection(line: string): string | null {
  const trimmedLine = line.trim();

  // Check if line starts with '[' and ends with ']'
  if (!trimmedLine.startsWith('[') || !trimmedLine.endsWith(']')) {
    return null;
  }

  // Extract the section name (content between brackets)
  const sectionName = trimmedLine.slice(1, -1).trim();

  // Return null for empty section names
  if (sectionName === '') {
    return null;
  }

  return sectionName;
}

/**
 * Parses a key=value line and returns the key and value.
 *
 * @param line - A single line from an INI file
 * @returns An object with key and value if valid, null otherwise
 *
 * @example
 * parseKeyValue('host=localhost') // returns { key: 'host', value: 'localhost' }
 * parseKeyValue('key = value')    // returns { key: 'key', value: 'value' }
 * parseKeyValue('[section]')      // returns null
 */
export function parseKeyValue(line: string): KeyValuePair | null {
  // Find the first '=' character
  const equalsIndex = line.indexOf('=');

  // Return null if no '=' found
  if (equalsIndex === -1) {
    return null;
  }

  // Split on first '=' only
  const key = line.slice(0, equalsIndex).trim();
  let value = line.slice(equalsIndex + 1).trim();

  // Return null if key is empty
  if (key === '') {
    return null;
  }

  // Handle quoted values by stripping matching single or double quotes
  if (value.length >= 2) {
    const firstChar = value[0];
    const lastChar = value[value.length - 1];
    if ((firstChar === '"' && lastChar === '"') || (firstChar === "'" && lastChar === "'")) {
      value = value.slice(1, -1);
    }
  }

  return { key, value };
}

/**
 * Checks if a line is a comment (starts with ; or #).
 *
 * @param line - A single line from an INI file
 * @returns true if the line is a comment, false otherwise
 *
 * @example
 * isComment('; comment')  // returns true
 * isComment('# comment')  // returns true
 * isComment('key=value')  // returns false
 */
export function isComment(line: string): boolean {
  const trimmedLine = line.trimStart();

  // Empty strings and whitespace-only lines are not comments
  if (trimmedLine === '') {
    return false;
  }

  // A line is a comment only if it starts with ';' or '#'
  const firstChar = trimmedLine[0];
  return firstChar === ';' || firstChar === '#';
}

/**
 * Parses an INI file content string into a structured data object.
 *
 * @param content - The full content of an INI file
 * @returns An IniData object representing the parsed content
 *
 * @example
 * const ini = `
 * [database]
 * host=localhost
 * port=3306
 * `;
 * parseIni(ini) // returns { database: { host: 'localhost', port: '3306' } }
 */
export function parseIni(content: string): IniData {
  const result: IniData = {};

  // Handle empty/whitespace-only input
  if (content.trim() === '') {
    return result;
  }

  // Split content by newlines (handle both LF and CRLF)
  const lines = content.split(/\r?\n/);

  // Track current section (empty string for global/no section)
  let currentSection = '';

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }

    // Skip comments
    if (isComment(line)) {
      continue;
    }

    // Check for section header
    const sectionName = parseSection(line);
    if (sectionName !== null) {
      currentSection = sectionName;
      // Ensure section exists in result
      if (!(currentSection in result)) {
        result[currentSection] = {};
      }
      continue;
    }

    // Try to parse as key-value pair
    const keyValue = parseKeyValue(line);
    if (keyValue !== null) {
      // Ensure current section exists in result
      if (!(currentSection in result)) {
        result[currentSection] = {};
      }
      // Store pair in current section (last value wins for duplicates)
      result[currentSection][keyValue.key] = keyValue.value;
    }
  }

  return result;
}

/**
 * Serializes an IniData object back to INI format string.
 *
 * @param data - The IniData object to serialize
 * @returns An INI format string
 *
 * @example
 * const data = { database: { host: 'localhost', port: '3306' } };
 * serializeIni(data) // returns '[database]\nhost=localhost\nport=3306\n'
 */
export function serializeIni(data: IniData): string {
  const sections = Object.keys(data);

  // Handle empty data
  if (sections.length === 0) {
    return '';
  }

  const output: string[] = [];

  // Output global section first (key '') without section header
  if ('' in data) {
    const globalSection = data[''];
    const globalKeys = Object.keys(globalSection);
    if (globalKeys.length > 0) {
      for (const key of globalKeys) {
        output.push(`${key}=${globalSection[key]}`);
      }
      output.push('');
    }
  }

  // Output each named section with [sectionName] header
  for (const sectionName of sections) {
    if (sectionName === '') {
      continue;
    }

    output.push(`[${sectionName}]`);
    const section = data[sectionName];
    for (const key of Object.keys(section)) {
      output.push(`${key}=${section[key]}`);
    }
    output.push('');
  }

  return output.join('\n');
}
