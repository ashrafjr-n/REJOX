import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import ProductsPage from './pages/ProductsPage'
import ProductDetailPage from './pages/ProductDetailPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const [darkMode, setDarkMode] = useState(false)

  return (
    <Routes>
      <Route element={<Layout darkMode={darkMode} />}>
        <Route index element={<HomePage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route
          path="settings"
          element={<SettingsPage darkMode={darkMode} setDarkMode={setDarkMode} />}
        />
      </Route>
    </Routes>
  )
}
