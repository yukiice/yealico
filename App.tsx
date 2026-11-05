import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';

import { SiteManager } from './src/app/SiteManager';

function App(): React.JSX.Element {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>Yealico</Text>
      <SiteManager />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f1115',
    paddingTop: 48,
    paddingHorizontal: 16,
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
});

export default App;
