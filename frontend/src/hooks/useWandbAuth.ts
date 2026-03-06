"use client";

import { useState, useEffect } from "react";

export const useWandbAuth = () => {
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    setApiKey(localStorage.getItem("wandb_api_key"));
  }, []);

  const saveApiKey = (key: string) => {
    localStorage.setItem("wandb_api_key", key);
    setApiKey(key);
  };

  const removeApiKey = () => {
    localStorage.removeItem("wandb_api_key");
    setApiKey(null);
  };

  return { apiKey, saveApiKey, removeApiKey };
};
