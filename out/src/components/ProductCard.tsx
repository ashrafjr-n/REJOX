import { useNavigation } from '@react-navigation/native';
import { Image, Pressable, Text, View, StyleSheet } from 'react-native';
import type { Product } from '../lib/types'
import { useCartStore } from '../store/cartStore'
import Rating from './Rating'
import Button from './Button'
const styles = StyleSheet.create({
  card: { flexDirection: 'column', overflow: 'hidden', borderRadius: 12, backgroundColor: '#ffffff', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2 },
  cardPressed: { transform: [{ translateY: -2 }], shadowColor: '#0f172a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 20 },
  thumb: { aspectRatio: 1, width: '100%', backgroundColor: '#f1f5f9' },
});

// ===== REJOX-TODO: 2 item(s) need attention =====
// REJOX-TODO(IMAGE_SIZE): <Image> at line 19 had no provable width/height; injected 100 — adjust to the intended dimensions.
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 23: web defaults to row, RN to column — appended flex-row.

interface ProductCardProps {
  product: Product
}

/** Storefront card. Uses a CSS Module for the shell and Tailwind for content. */
export default function ProductCard({ product }: ProductCardProps) {
  const navigation = useNavigation<any>();
  const add = useCartStore((s) => s.add)

  return (
    <View style={styles.card}>
      <Pressable onPress={() => navigation.navigate('ProductDetail', { id: product.id })}><Image source={{ uri: product.thumbnailUrl }} accessibilityLabel={product.title} style={[styles.thumb, { width: 100, height: 100 }]} /></Pressable>
      <View className="flex flex-1 flex-col gap-2 p-4">
        <Pressable className="line-clamp-2 text-sm font-medium text-slate-800 active:text-indigo-600" onPress={() => navigation.navigate('ProductDetail', { id: product.id })}><Text>{product.title}</Text></Pressable>
        <Rating value={(product.id % 5) + 1} />
        <View className="mt-auto flex items-center justify-between pt-2 flex-row">
          <Text className="font-semibold text-slate-900">
            ${product.price.toFixed(2)}
          </Text>
          <Button onPress={() => add(product)}><Text>Add</Text></Button>
        </View>
      </View>
    </View>
  )
}
