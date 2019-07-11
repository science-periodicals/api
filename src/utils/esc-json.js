export default function escJSON(obj) {
  return JSON.stringify(obj).replace(/<\/script/gi, '<\\u002fscript');
}
