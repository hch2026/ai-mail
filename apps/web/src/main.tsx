import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import "antd/dist/reset.css";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.js";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <App />
      </AntApp>
    </QueryClientProvider>
  </React.StrictMode>,
);
