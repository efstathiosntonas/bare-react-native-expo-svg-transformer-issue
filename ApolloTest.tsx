import React from 'react';

import {Text, View} from 'react-native';
import {gql, useQuery} from '@apollo/client';

const GET_LOCATIONS = gql`
  query Account {
    account_by_pk(id: "M5txLRYc5TMeDzknV9DUNaDoAHl2") {
      first_name
    }
  }
`;

const ApolloTest = () => {
  const {loading, error, data} = useQuery(GET_LOCATIONS);

  console.log(loading, error, data);

  return <Text></Text>;
};

export default ApolloTest;
