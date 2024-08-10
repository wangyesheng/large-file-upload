import "./FileUploader.css";
import { useCallback, useRef, useState, useEffect } from "react";
import { Button, Progress, message } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import axios from "axios";
import useDrag from "./hooks/useDrag";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10M
const UPLOAD_STATUS = {
  PENDDING: "PENDDING",
  UPLOADING: "UPLOADING",
  PAUSE: "PAUSE",
};
const MAX_RETRY_COUNT = 3; // 最大的重试次数

function createFileChunks(filename, file) {
  const chunks = [];
  // 计算要切成多少份（向上取整）
  const count = Math.ceil(file.size / CHUNK_SIZE);
  for (let i = 0; i < count; i++) {
    const chunkFilename = filename + "-" + i;
    const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    chunks.push({
      chunk,
      chunkFilename,
    });
  }
  return chunks;
}

function createRequest(
  chunks,
  filename,
  setUploadProgressMap,
  setCancelTokens,
  uploadedChunks
) {
  const cancelTokens = [];

  const requests = chunks.map(({ chunk, chunkFilename }) => {
    const cancelToken = axios.CancelToken.source();
    cancelTokens.push(cancelToken);

    // 判断当前的分片是否已经上传过服务器
    const uploadedChunk = uploadedChunks.find(
      (chunk) => chunk.chunkFilename === chunkFilename
    );

    // 切片总大小，为计算上传进度做准备
    const totalThunkSize = chunk.size;

    if (uploadedChunk) {
      // 从 chunk 中截取，过滤掉已经上传过的大小，得到需要继续上传的分片内容
      chunk = chunk.slice(uploadedChunk.size);
      // 之前已经上传完毕了，直接返回成功态的 promise
      if (chunk.size === 0) {
        setUploadProgressMap((prevProgressMap) => ({
          ...prevProgressMap,
          [chunkFilename]: 100,
        }));
        return Promise.resolve();
      }
    }

    // 上次写入到哪个位置结束，下次就从哪个位置开始写入，没有就为0
    const start = uploadedChunk ? uploadedChunk.size : 0;

    return axios.post(`http://localhost:18080/api/upload/${filename}`, chunk, {
      headers: {
        "Content-Type": "application/octet-stream", // 二进制字节流
      },
      params: {
        chunkFilename,
        start, // 写入文件的起始位置
      },
      onUploadProgress(e) {
        // （ 实时上传大小 + 之前已经上传过的大小（没有为0）） / 切片总大小
        const percent = Math.round(((e.loaded + start) / totalThunkSize) * 100);
        setUploadProgressMap((prevProgressMap) => ({
          ...prevProgressMap,
          [chunkFilename]: percent,
        }));
      },
      cancelToken: cancelToken.token,
    });
  });

  setCancelTokens(cancelTokens);

  return requests;
}

async function uploadFile(
  filename,
  file,
  setUploadProgressMap,
  resetAllOperates,
  setCancelTokens,
  retryCount = 0
) {
  const {
    data: { exist, uploadedChunks },
  } = await axios.get(
    `http://localhost:18080/api/checkFileIsExist/${filename}`
  );
  if (exist) {
    message.success("Seconds transfer success");
    resetAllOperates();
    return;
  }
  const chunks = createFileChunks(filename, file);
  const requests = createRequest(
    chunks,
    filename,
    setUploadProgressMap,
    setCancelTokens,
    uploadedChunks
  );

  try {
    // 并行上传每一个分片
    await Promise.all(requests);
    // 合并分片
    await axios.get(`http://localhost:18080/api/merge/${filename}`, {
      params: {
        chunkSize: CHUNK_SIZE,
      },
    });
    resetAllOperates();
    message.success("Upload successfully");
  } catch (error) {
    console.log(error);
    if (axios.isCancel(error)) {
      message.error(error.message);
    } else {
      // 上传失败重试
      if (retryCount < MAX_RETRY_COUNT) {
        await uploadFile(
          filename,
          file,
          setUploadProgressMap,
          resetAllOperates,
          setCancelTokens,
          retryCount + 1
        );
        return;
      }
      message.error("Upload failed");
    }
  }
}

function App() {
  const uploaderRef = useRef(null);
  const controlFileRef = useRef(null);
  const { selectedFile, previewFile, resetFile, checkFile } =
    useDrag(uploaderRef);
  const [uploadProgressMap, setUploadProgressMap] = useState({});
  const [uploadStatus, setUploadStatus] = useState(UPLOAD_STATUS.PENDDING);
  // 取消上传
  const [cancelTokens, setCancelTokens] = useState([]);
  const [filenameWorker, setFilenameWorker] = useState(null);
  const [isCalcingFilename, setIsCalcingFilename] = useState(false);

  useEffect(() => {
    // public 目录下的 filenameWorker.js
    setFilenameWorker(new Worker("/filenameWorker.js"));
  }, []);

  const resetAllOperates = useCallback(() => {
    resetFile();
    setUploadProgressMap({});
    setUploadStatus(UPLOAD_STATUS.PENDDING);
  }, []);

  const onUpload = useCallback(
    async function () {
      if (!selectedFile) {
        return message.warning("Please choose file");
      }

      // 向 web worker 发送一条消息让其帮忙计算耗时的文件内容 hash 值
      // 目的：不阻塞 UI 渲染，单独开了一个子进程，不是为了计算快
      filenameWorker.postMessage(selectedFile);
      setIsCalcingFilename(true);
      // 监听发送过来的消息，接收计算好的文件名
      filenameWorker.onmessage = async (e) => {
        setIsCalcingFilename(false);
        setUploadStatus(UPLOAD_STATUS.UPLOADING);
        await uploadFile(
          e.data,
          selectedFile,
          setUploadProgressMap,
          resetAllOperates,
          setCancelTokens
        );
      };
    },
    [selectedFile, filenameWorker]
  );

  const onPause = useCallback(() => {
    setUploadStatus(UPLOAD_STATUS.PAUSE);
    cancelTokens.forEach((token) => token.cancel("User initiated suspension"));
  }, [cancelTokens]);

  const renderButton = () => {
    if (uploadStatus === UPLOAD_STATUS.PENDDING) {
      return (
        <Button
          block
          type="primary"
          loading={isCalcingFilename}
          style={{ marginTop: 10 }}
          onClick={onUpload}
        >
          {isCalcingFilename ? "Calculating file hash..." : "Upload"}
        </Button>
      );
    } else if (uploadStatus === UPLOAD_STATUS.UPLOADING) {
      return (
        <Button
          block
          type="primary"
          style={{ marginTop: 10 }}
          onClick={onPause}
        >
          Pause
        </Button>
      );
    } else if (uploadStatus === UPLOAD_STATUS.PAUSE) {
      return (
        <Button
          block
          type="primary"
          style={{ marginTop: 10 }}
          onClick={onUpload}
        >
          Resume
        </Button>
      );
    }
  };

  const onFileWrapperClick = useCallback(() => {
    controlFileRef.current?.click?.();
  }, []);

  const onControlFileChange = useCallback((e) => {
    checkFile(e.target.files);
    // React Input onchange事件第二次不执行的解决办法
    // https://blog.csdn.net/q553866469/article/details/117550508
    // https://blog.csdn.net/qq_19734597/article/details/116269179
    controlFileRef.current.value = null;
  }, []);

  return (
    <div className="uploader-container">
      <div className="title">
        <h1>Large file upload</h1>
        <h3>
          <span>Multi-part upload</span>
          <span>Seconds</span>
          <span>Resume download</span>
        </h3>
      </div>
      <div className="uploader-inner">
        <div
          className="file-wrapper"
          ref={uploaderRef}
          onClick={onFileWrapperClick}
        >
          {renderFile(previewFile)}
        </div>
        <input
          className="controlFile"
          type="file"
          ref={controlFileRef}
          onChange={onControlFileChange}
        />
        {renderButton()}
        {renderProgress(uploadProgressMap)}
      </div>
    </div>
  );
}

function renderProgress(uploadProgressMap) {
  return Object.keys(uploadProgressMap).map((key, index) => (
    <div className="mt10" key={key}>
      <span>
        chunk{index}：{key}
      </span>
      <Progress percent={uploadProgressMap[key]} />
    </div>
  ));
}

function renderFile({ url, type }) {
  if (url) {
    if (type.startsWith("video/")) {
      return <video src={url} alt="preview" controls />;
    } else if (type.startsWith("image/")) {
      return <img src={url} alt="preview" />;
    } else {
      return url;
    }
  } else {
    return (
      <div className="drag">
        <InboxOutlined />
        <span className="desc">Click here or drag files here to upload</span>
      </div>
    );
  }
}

export default App;
