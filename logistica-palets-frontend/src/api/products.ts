import { api } from "./client";

export type Product = {
  id: string;
  code: string;
  description: string;
  unitOfMeasure?: string;
  active: boolean;
};

export async function listProducts() {
  const { data } = await api.get<Product[]>("/products");
  return data;
}

export async function createProduct(payload: {
  code: string;
  description: string;
  unitOfMeasure?: string;
  active?: boolean;
}) {
  const { data } = await api.post<Product>("/products", payload);
  return data;
}

export async function deleteProduct(id: string) {
  await api.delete(`/products/${id}`);
}
