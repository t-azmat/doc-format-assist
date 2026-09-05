import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  createSampleManuscript,
  getGetDocumentQueryKey,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "./use-toast";

export function useSampleManuscript() {
  const [creating, setCreating] = useState(false);
  const busy = useRef(false);
  const [, navigate] = useLocation();
  const cache = useQueryClient();
  const { toast } = useToast();
  const create = async () => {
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    try {
      const sample = await createSampleManuscript();
      cache.setQueryData(getGetDocumentQueryKey(sample.id), sample);
      void cache.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      navigate(`/documents/${sample.id}`);
    } catch (error) {
      toast({
        title: "Couldn't open a sample",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      busy.current = false;
      setCreating(false);
    }
  };
  return { create, creating };
}
