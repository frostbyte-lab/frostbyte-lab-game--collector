import React from 'react';
import { Stack } from 'expo-router';

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Back' }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <RootLayoutNav />
  );
}
