"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/browser";
import { Icon } from "./icons";
export function RestaurantPhoto({
  path,
  name,
}: {
  path: string | null;
  name: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl("");
    setFailed(false);
    if (path)
      void supabase()
        .storage.from("restaurant-photos")
        .createSignedUrl(path, 3600)
        .then(({ data }) => {
          if (active && data) setUrl(data.signedUrl);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [path]);
  return (
    <div className="restaurant-photo">
      {url && !failed ? (
        <img
          src={url}
          alt={`Foto de ${name}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="restaurant-photo-placeholder" aria-hidden="true">
          <Icon name="restaurants" />
        </span>
      )}
    </div>
  );
}
