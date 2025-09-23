/**
 * Returns file header content with a timestamp.
 * Style Dictionary will wrap this in the appropriate comment style.
 * @param {string[]} [comments=[]] - An array of strings to add as comments.
 * @returns {string[]} - An array of strings for the file header.
 */
export function fileHeader(comments = []) {
  // Style-dictionary expects an array of strings for the file header.
  const header = [`Do not edit — auto-generated`];
  const date = new Date();
  const options = {
    timeZone: 'Asia/Bangkok', // GMT+7
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  };
  header.push(`on ${date.toLocaleString('en-GB', options)}`);

  if (comments.length > 0) {
    header.push('', ...comments);
  }

  return header;
}