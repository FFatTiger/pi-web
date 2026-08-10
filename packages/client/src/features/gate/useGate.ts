import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import type { GateLoginInput } from "@/api/gate";
import { useHttpClient } from "@/app/http-context";
import { createGateApi } from "@/api/gate";

export function useGateStatus(enabled = true) {
  const http = useHttpClient();
  const api = createGateApi(http);

  return useQuery({
    queryKey: queryKeys.gate.status(),
    queryFn: ({ signal }) => api.status(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useGateLogin() {
  const http = useHttpClient();
  const api = createGateApi(http);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: GateLoginInput) => api.login(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.gate.all });
    },
  });
}

export function useGateLogout() {
  const http = useHttpClient();
  const api = createGateApi(http);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.gate.all });
    },
  });
}
