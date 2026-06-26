import MultiPageEngine from "./MultiPageEngine";

export default function DownloadMaintenancePage({ fileId }: { fileId: string }) {
  return <MultiPageEngine type="download" id={fileId} />;
}
