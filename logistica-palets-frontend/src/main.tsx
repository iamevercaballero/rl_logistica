import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AuthProvider } from "./auth/AuthContext";
import RequireRole from "./auth/RequireRole";
import "./index.css";
import { queryClient } from "./lib/queryClient";
import { ThemeProvider } from "./design-system/theme";
import { ToastProvider } from "./design-system/toast";
import AppLayout from "./layouts/AppLayout";
import DashboardPage from "./pages/Dashboard";
import LocationsPage from "./pages/Locations";
import LoginPage from "./pages/Login";
import LotsPage from "./pages/Lots";
import MovementsPage from "./pages/Movements";
import PalletsPage from "./pages/Pallets";
import ProductsPage from "./pages/Products";
import ReportsPage from "./pages/Reports";
import TransportsPage from "./pages/Transports";
import WarehousesPage from "./pages/Warehouses";
import BillingPage from "./pages/Billing";
import SeedPage from "./pages/Seed";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: "products",
        element: (
          <RequireRole module="products">
            <ProductsPage />
          </RequireRole>
        ),
      },
      {
        path: "warehouses",
        element: (
          <RequireRole module="warehouses">
            <WarehousesPage />
          </RequireRole>
        ),
      },
      {
        path: "locations",
        element: (
          <RequireRole module="locations">
            <LocationsPage />
          </RequireRole>
        ),
      },
      {
        path: "lots",
        element: (
          <RequireRole module="lots">
            <LotsPage />
          </RequireRole>
        ),
      },
      {
        path: "pallets",
        element: (
          <RequireRole module="pallets">
            <PalletsPage />
          </RequireRole>
        ),
      },
      {
        path: "movements",
        element: (
          <RequireRole module="movements">
            <MovementsPage />
          </RequireRole>
        ),
      },
      {
        path: "transports",
        element: (
          <RequireRole module="transports">
            <TransportsPage />
          </RequireRole>
        ),
      },
      {
        path: "reports",
        element: (
          <RequireRole module="reports">
            <ReportsPage />
          </RequireRole>
        ),
      },
      {
        path: "billing",
        element: (
          <RequireRole module="billing">
            <BillingPage />
          </RequireRole>
        ),
      },
      { path: "seed", element: <SeedPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />}
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
