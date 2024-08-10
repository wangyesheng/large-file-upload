self.addEventListener("message", async (e) => {
  // 获取子进程发过来的文件
  const file = e.data;
  // 单独开一个子进程来计算文件内容 hash
  const filename = await getFilename(file);
  // 把文件名再发送给主进程
  self.postMessage(filename);
});

/**
 * 根据文件对象的文件内容计算 hash 文件名
 * @param {*} file 文件对象
 */
async function getFilename(file) {
  const fileHash = await calcFileHash(file);
  const fileExt = file.name.split(".").pop();
  return `${fileHash}.${fileExt}`;
}

async function calcFileHash(file) {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return bufferToHex(hashBuffer);
}

/**
 * 将 buffer 转成16进制的字符串
 * @param {*} buffer
 */
function bufferToHex(buffer) {
  // 0. buffer 是二进制的，不能直接读写，所以需要将其转换成一个可读写的字符串
  // 1. 把 buffer 转成无符号的8位的整型类数组
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
