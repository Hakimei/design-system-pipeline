/**
 * Returns file header content with a timestamp.
 * Style Dictionary will wrap this in the appropriate comment style.
 * @returns {string[]}
 */
export function fileHeader() {
  // Style-dictionary expects an array of strings for the file header.
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
  return [`Do not edit — auto-generated on ${date.toLocaleString('en-GB', options)}`];
}