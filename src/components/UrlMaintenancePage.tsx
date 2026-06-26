import MultiPageEngine from "./MultiPageEngine";

export default function UrlMaintenancePage({ linkId }: { linkId: string }) {
  return <MultiPageEngine type="shortener" id={linkId} />;
}
