import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
});

export const baseURL = axiosInstance.defaults.baseURL;
export default axiosInstance;


