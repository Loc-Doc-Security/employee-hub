import { useEffect, useState } from "react";
import { LabHubBackLink } from "lab-theme/HubBackLink";
import { apiGet } from "../lib/api";

export default function HubBackLink() {
  const [hubUrl, setHubUrl] = useState<string | null>(null);
  useEffect(() => {
    void apiGet<{ hubAppUrl?: string }>("/api/auth/config")
      .then((c) => c.hubAppUrl && setHubUrl(c.hubAppUrl.replace(/\/$/, "")))
      .catch(() => undefined);
  }, []);
  return hubUrl ? <LabHubBackLink href={hubUrl} /> : null;
}