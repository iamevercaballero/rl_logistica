import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/Login";
import ProductsPage from "./pages/Products";
import WarehousesPage from "./pages/Warehouses";
import LocationsPage from "./pages/Locations";
import LotsPage from "./pages/Lots";
import PalletsPage from "./pages/Pallets";
import MovementsPage from "./pages/Movements";
import TransportsPage from "./pages/Transports";
import RequireRole from "./auth/RequireRole";
import DashboardPage from "./pages/Dashboard";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";
import { ToastProvider } from "./components/ToastProvider";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },

  {
    path: "/",
    element: <AppLayout />,
    children: [

      { index: true, element: <DashboardPage /> },


      { path: "products", element: <RequireRole module="products"><ProductsPage /></RequireRole> },
      { path: "warehouses", element: <RequireRole module="warehouses"><WarehousesPage /></RequireRole> },
      { path: "locations", element: <RequireRole module="locations"><LocationsPage /></RequireRole> },
      { path: "lots", element: <RequireRole module="lots"><LotsPage /></RequireRole> },
      { path: "pallets", element: <RequireRole module="pallets"><PalletsPage /></RequireRole> },
      { path: "movements", element: <RequireRole module="movements"><MovementsPage /></RequireRole> },
      { path: "transports", element: <RequireRole module="transports"><TransportsPage /></RequireRole> },

      { path: "*", element: <div>404 - Ruta no encontrada</div> },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>
);
