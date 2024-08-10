const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const logger = require("morgan");
const cros = require("cors");

// 存放合并成功的文件
const FILE_PATH = path.resolve(__dirname, "public");
// 存放分片文件
const TEMP_FILE_PATH = path.resolve(__dirname, "temp");
fs.ensureDirSync(FILE_PATH);
fs.ensureDirSync(TEMP_FILE_PATH);

const app = express();

// app.use(logger("dev"));
app.use(cros());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(FILE_PATH));

app.get("/api/checkFileIsExist/:filename", async (req, res, next) => {
  const { filename } = req.params;
  const filepath = path.join(FILE_PATH, filename);
  const exist = await fs.pathExists(filepath);
  if (exist) {
    res.json({
      code: 0,
      exist: true,
    });
  } else {
    // 看临时文件目录有没有该文件上传的切片，断点续传
    const tempFileDir = path.join(TEMP_FILE_PATH, filename);
    const tempExist = await fs.pathExists(tempFileDir);
    let uploadedChunks = [];
    if (tempExist) {
      const chunkFilenames = await fs.readdir(tempFileDir);
      uploadedChunks = await Promise.all(
        chunkFilenames.map(async (chunkFilename) => {
          const stat = await fs.stat(path.join(tempFileDir, chunkFilename));
          return {
            chunkFilename,
            // 已经上传的切片大小，为后续前端计算剩余切片和断点续传的起始位置做准备
            size: stat.size,
          };
        })
      );
    }
    res.json({
      code: 0,
      exist: false,
      uploadedChunks,
    });
  }
});

app.post("/api/upload/:filename", async (req, res, next) => {
  const { filename } = req.params;
  const { chunkFilename, start } = req.query;
  const chunkDir = path.join(TEMP_FILE_PATH, filename);
  fs.ensureDirSync(chunkDir);
  const chunkFilePath = path.join(chunkDir, chunkFilename);
  const ws = fs.createWriteStream(chunkFilePath, {
    start: Number(start),
    // 以追加模式打开文件
    // 之前暂停上传了，但是该文件的切片信息已经保存在了切片的临时目录下，
    // 下次从已经存在的切片内容末尾（start）处追加新的切片信息
    flags: "a",
  });

  // 暂停操作，如果客户端点击了暂停按钮，会取消上传操作，取消之后会在服务端触发请求对象的 aborted 事件，关闭可写流
  req.on("aborted", () => {
    ws.close();
  });
  try {
    await pipeStream(req, ws);
    res.json({
      code: 0,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/merge/:filename", async (req, res, next) => {
  const { filename } = req.params;
  const { chunkSize } = req.query;
  const chunkDir = path.join(TEMP_FILE_PATH, filename);
  let chunkFiles = await fs.readdir(chunkDir);
  // 对分片按索引进行升序排序
  chunkFiles = chunkFiles.sort(
    (a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1])
  );

  try {
    // 提高性能，将分片信息并行写入目标文件
    await Promise.all(
      chunkFiles.map((file, index) =>
        pipeStream(
          // 创建分片信息的可读流
          fs.createReadStream(path.join(chunkDir, file), { autoClose: true }),
          // 创建目标文件的可写流
          fs.createWriteStream(path.join(FILE_PATH, filename), {
            // 从文件的什么位置开始写入
            start: index * chunkSize,
          })
        )
      )
    );
    // 删除分片文件夹和文件
    await fs.rm(chunkDir, { recursive: true, force: true });

    res.json({
      code: 0,
    });
  } catch (error) {
    next(error);
  }
});

function pipeStream(rs, ws) {
  return new Promise((resolve, reject) => {
    // 将可读流写入到可写流中
    rs.pipe(ws).on("finish", resolve).on("error", reject);
  });
}

app.listen(18080, () => {
  console.log(`Server start in port 18080`);
});
