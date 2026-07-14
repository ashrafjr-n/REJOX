import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomePage from '../screens/HomePage';
import ProductDetailPage from '../screens/ProductDetailPage';
import ProductsPage from '../screens/ProductsPage';
import SettingsPage from '../screens/SettingsPage';

const ProductsStack = createNativeStackNavigator();

function ProductsNavigator() {
  return (
    <ProductsStack.Navigator>
        <ProductsStack.Screen name="Products" component={ProductsPage} />
        <ProductsStack.Screen name="ProductDetail" component={ProductDetailPage} />
    </ProductsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator initialRouteName="Home">
        <Tab.Screen name="Home" component={HomePage} />
        <Tab.Screen name="Products" component={ProductsNavigator} />
        <Tab.Screen name="Settings" component={SettingsPage} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
