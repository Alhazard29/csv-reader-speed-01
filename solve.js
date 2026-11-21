// solve.js — a fast drop-in for csv-reader 1.0.0.
//
// Written from the competition's description of csv-reader 1.0.0 semantics
// (RULES.txt / competition.yaml) plus the practice input/expected pairs.
// Single-pass scanner over the text, char-code loop, slice-based fields.
//
// Semantics implemented:
//  - A U+FEFF at the very start is dropped.
//  - A record ends at LF or CRLF; a line left with no characters is no record.
//  - Outside quotes, a CR not followed by LF is dropped (error stray_cr).
//  - A field that opens with a quote runs to the next quote that is not
//    doubled; "" inside = one literal quote; each CRLF or lone CR inside it
//    is read as LF; what follows its closing quote, up to the next comma or
//    line break, is appended as it stands (quote_junk error, emitted when
//    the field ends); a quote that never closes is a literal character, and
//    the text after it is read again as unquoted (unterminated_quote error).
//  - A quote inside an unquoted field is a literal character.
//  - Fields stay strings, never trimmed or converted.
//  - columns = first record when header is true, else null. rows = records
//    after it (every record when header is false), each padded with empty
//    strings to the first record's width (short_row, with fields: its field
//    count) or cut (long_row, with extra: the cut fields).
//  - Each error is {code, line, row} in the order met; a record's
//    short_row/long_row is emitted when the record ends: line = 1-based line
//    its record starts on, counting every LF, CRLF and lone CR inside
//    quotes; row = the record's index in rows, null for the header.

export function run(input) {
  const text = input.text;
  const header = input.header;
  const n = text.length;
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;

  const rows = [];
  const errors = [];
  let columns = null;

  let line = 1;          // 1-based line number of the current position
  let width = -1;        // field count of the first record
  let recordIndex = 0;   // records completed so far

  // Row index of the record currently being parsed (null for the header).
  const curRow = () => (header && recordIndex === 0 ? null : rows.length);

  // Main record loop.
  outer: while (true) {
    if (i >= n) break;
    // Skip empty lines: a line left with no characters is no record.
    const c0 = text.charCodeAt(i);
    if (c0 === 10) { line++; i++; continue; }
    if (c0 === 13) {
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) { line++; i += 2; continue; }
      // Lone CR at record start: dropped, stray_cr, then re-check the line.
      errors.push({ code: 'stray_cr', line: recordStartLine, row: curRow() });
      i++;
      continue;
    }

    const recordStartLine = line;
    const fields = [];

    // Field loop.
    while (true) {
      let value;
      let end; // 0 = comma (next field), 1 = end of record (LF/CRLF), 2 = EOF

      if (i < n && text.charCodeAt(i) === 34) {
        // ---- Quoted field ----
        const quoteLine = line;
        let j = i + 1;
        let parts = null;   // string parts, when escapes/newlines force a join
        let seg = j;        // start of the current raw segment
        let closed = -1;    // index of the closing quote, -1 = unterminated
        while (j < n) {
          const c = text.charCodeAt(j);
          if (c === 34) {
            if (j + 1 < n && text.charCodeAt(j + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(text.slice(seg, j));
              parts.push('"');
              j += 2; seg = j;
              continue;
            }
            closed = j;
            break;
          } else if (c === 13) {
            if (j + 1 < n && text.charCodeAt(j + 1) === 10) {
              if (parts === null) parts = [];
              parts.push(text.slice(seg, j));
              parts.push('\n');
              j += 2; seg = j; line++;
              continue;
            }
            if (parts === null) parts = [];
            parts.push(text.slice(seg, j));
            parts.push('\n');
            j += 1; seg = j; line++;
            continue;
          } else if (c === 10) {
            if (parts === null) parts = [];
            parts.push(text.slice(seg, j));
            parts.push('\n');
            j += 1; seg = j; line++;
            continue;
          }
          j++;
        }

        if (closed < 0) {
          // ---- Unterminated quote: opener is literal, rest re-read unquoted.
          errors.push({ code: 'unterminated_quote', line: recordStartLine, row: curRow() });
          // Rewind the line counter to the opening quote; the re-read will
          // advance it again as it meets real line breaks.
          line = quoteLine;
          // Re-read as unquoted from just after the opener, prefix '"'.
          let k = i + 1;
          let p2 = ['"'];
          let s2 = k;
          let done = false;
          while (!done) {
            if (k >= n) {
              value = p2.join('') + text.slice(s2, k);
              i = k; end = 2;
              done = true;
            } else {
              const c = text.charCodeAt(k);
              if (c === 44) {
                value = p2.join('') + text.slice(s2, k);
                i = k + 1; end = 0;
                done = true;
              } else if (c === 10) {
                value = p2.join('') + text.slice(s2, k);
                i = k + 1; line++; end = 1;
                done = true;
              } else if (c === 13) {
                if (k + 1 < n && text.charCodeAt(k + 1) === 10) {
                  value = p2.join('') + text.slice(s2, k);
                  i = k + 2; line++; end = 1;
                  done = true;
                } else {
                  errors.push({ code: 'stray_cr', line: recordStartLine, row: curRow() });
                  p2.push(text.slice(s2, k));
                  k += 1; s2 = k;
                }
              } else {
                k++;
              }
            }
          }
        } else {
          // ---- Closed: value, then junk up to the next comma / line break.
          let k = closed + 1;
          let junkStart = k;
          let junkParts = null;
          let junkEnd = -1; // end kind for the junk scan
          while (true) {
            if (k >= n) { junkEnd = 2; break; }
            const c = text.charCodeAt(k);
            if (c === 44) { junkEnd = 0; break; }
            if (c === 10) { junkEnd = 1; break; }
            if (c === 13) {
              if (k + 1 < n && text.charCodeAt(k + 1) === 10) { junkEnd = 1; break; }
              // Lone CR in the junk region: dropped (stray_cr), junk continues.
              errors.push({ code: 'stray_cr', line: recordStartLine, row: curRow() });
              if (junkParts === null) junkParts = [];
              junkParts.push(text.slice(junkStart, k));
              k += 1; junkStart = k;
              continue;
            }
            k++;
          }
          const junk = junkParts === null
            ? text.slice(junkStart, k)
            : junkParts.join('') + text.slice(junkStart, k);
          if (junk.length > 0) {
            errors.push({ code: 'quote_junk', line: recordStartLine, row: curRow() });
          }
          if (parts === null) {
            value = junk.length > 0 ? text.slice(seg, closed) + junk : text.slice(seg, closed);
          } else {
            value = parts.join('') + text.slice(seg, closed) + junk;
          }
          if (junkEnd === 0) { i = k + 1; end = 0; }
          else if (junkEnd === 1) {
            // CRLF consumed both chars; LF consumed one.
            if (k < n && text.charCodeAt(k) === 13) i = k + 2; else i = k + 1;
            line++; end = 1;
          } else { i = k; end = 2; }
        }
      } else {
        // ---- Unquoted field ----
        let j = i;
        let parts = null;
        let seg = j;
        let done = false;
        while (!done) {
          if (j >= n) {
            value = parts === null ? text.slice(seg, j) : parts.join('') + text.slice(seg, j);
            i = j; end = 2;
            done = true;
          } else {
            const c = text.charCodeAt(j);
            if (c === 44) {
              value = parts === null ? text.slice(seg, j) : parts.join('') + text.slice(seg, j);
              i = j + 1; end = 0;
              done = true;
            } else if (c === 10) {
              value = parts === null ? text.slice(seg, j) : parts.join('') + text.slice(seg, j);
              i = j + 1; line++; end = 1;
              done = true;
            } else if (c === 13) {
              if (j + 1 < n && text.charCodeAt(j + 1) === 10) {
                value = parts === null ? text.slice(seg, j) : parts.join('') + text.slice(seg, j);
                i = j + 2; line++; end = 1;
                done = true;
              } else {
                errors.push({ code: 'stray_cr', line: recordStartLine, row: curRow() });
                if (parts === null) parts = [];
                parts.push(text.slice(seg, j));
                j += 1; seg = j;
              }
            } else {
              j++;
            }
          }
        }
      }

      fields.push(value);
      if (end !== 0) break; // record ended (EOL or EOF)
    }

    // ---- Record complete: width handling ----
    if (recordIndex === 0) {
      width = fields.length;
      if (header) columns = fields;
      else rows.push(fields);
    } else {
      if (fields.length < width) {
        const row = curRow();
        errors.push({ code: 'short_row', line: recordStartLine, row: row, fields: fields.length });
        while (fields.length < width) fields.push('');
        rows.push(fields);
      } else if (fields.length > width) {
        const row = curRow();
        errors.push({ code: 'long_row', line: recordStartLine, row: row, extra: fields.slice(width) });
        fields.length = width;
        rows.push(fields);
      } else {
        rows.push(fields);
      }
    }
    recordIndex++;
  }

  return { columns: columns, rows: rows, errors: errors };
}
