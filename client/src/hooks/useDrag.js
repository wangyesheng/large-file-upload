import { message } from "antd";
import { useCallback, useEffect, useState } from "react";

export default function useDrag(containerRef) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewFile, setPreviewFile] = useState({
    url: null,
    type: null,
  });
  const handleDrag = useCallback(function (e) {
    e.stopPropagation();
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(function (e) {
    e.stopPropagation();
    e.preventDefault();
    const { files } = e.dataTransfer;
    checkFile(files);
  }, []);

  const checkFile = useCallback(function (files) {
    const file = files[0];
    if (!file) {
      return message.warning("Please choose file");
    }
    setSelectedFile(file);
  }, []);

  const resetFile = useCallback(function () {
    setSelectedFile(null);
    setPreviewFile({ url: null, type: null });
  }, []);

  useEffect(() => {
    if (!selectedFile) return;
    const url = URL.createObjectURL(selectedFile);
    setPreviewFile({
      url,
      type: selectedFile.type,
    });

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedFile]);

  useEffect(() => {
    const container = containerRef.current;
    container.addEventListener("dragenter", handleDrag);
    container.addEventListener("dragover", handleDrag);
    container.addEventListener("drop", handleDrop);
    container.addEventListener("dragleave", handleDrag);

    return () => {
      container.removeEventListener("dragenter", handleDrag);
      container.removeEventListener("dragover", handleDrag);
      container.removeEventListener("drop", handleDrop);
      container.removeEventListener("dragleave", handleDrag);
    };
  }, []);

  return {
    selectedFile,
    previewFile,
    resetFile,
    checkFile,
  };
}
