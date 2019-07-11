export default function escHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</, '&lt;');
}
