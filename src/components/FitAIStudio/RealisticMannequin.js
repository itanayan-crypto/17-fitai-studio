import * as THREE from "three";

export const SKIN = {
  f: 0xd9ad91,
  m: 0xc99a7a,
};

const makeBone = (name, parent, x, y, z) => {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(x, y, z);
  if (parent) parent.add(bone);
  return bone;
};

function addSkinAttributes(geometry, boneIndex) {
  const count = geometry.attributes.position.count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = boneIndex;
    weights[i * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

export function buildMannequin(gender = "f") {
  const isFemale = gender === "f";
  const group = new THREE.Group();
  group.name = `${isFemale ? "Female" : "Male"} mannequin`;

  const hips = makeBone("Hips", null, 0, 0.88, 0);
  const spine = makeBone("Spine", hips, 0, 0.2, 0);
  const neck = makeBone("Neck", spine, 0, 0.4, 0);
  const head = makeBone("Head", neck, 0, 0.12, 0);
  const leftShoulder = makeBone("LeftShoulder", spine, 0.18, 0.12, 0);
  const rightShoulder = makeBone("RightShoulder", spine, -0.18, 0.12, 0);
  const armLength = isFemale ? 0.265 : 0.285;
  const forearmLength = isFemale ? 0.245 : 0.265;
  const legWidth = isFemale ? 0.105 : 0.115;
  const leftArm = makeBone("LeftArm", leftShoulder, 0, 0, 0);
  const leftForeArm = makeBone("LeftForeArm", leftArm, armLength, 0, 0);
  const leftHand = makeBone("LeftHand", leftForeArm, 0.075, 0, 0);
  const rightArm = makeBone("RightArm", rightShoulder, 0, 0, 0);
  const rightForeArm = makeBone("RightForeArm", rightArm, -armLength, 0, 0);
  const rightHand = makeBone("RightHand", rightForeArm, -0.075, 0, 0);
  const leftUpLeg = makeBone("LeftUpLeg", hips, legWidth, -0.015, 0);
  const leftLeg = makeBone("LeftLeg", leftUpLeg, 0, -0.405, 0);
  const leftFoot = makeBone("LeftFoot", leftLeg, 0, -0.385, 0);
  const rightUpLeg = makeBone("RightUpLeg", hips, -legWidth, -0.015, 0);
  const rightLeg = makeBone("RightLeg", rightUpLeg, 0, -0.405, 0);
  const rightFoot = makeBone("RightFoot", rightLeg, 0, -0.385, 0);
  makeBone("LeftToeBase", leftFoot, 0, 0, 0.13);
  makeBone("RightToeBase", rightFoot, 0, 0, 0.13);

  const bones = [
    hips, spine, neck, head, leftShoulder, rightShoulder,
    leftArm, leftForeArm, leftHand, rightArm, rightForeArm, rightHand,
    leftUpLeg, leftLeg, leftFoot, rightUpLeg, rightLeg, rightFoot,
  ];
  const boneIndices = new Map(bones.map((bone, index) => [bone, index]));
  const skeleton = new THREE.Skeleton(bones);

  const skinMaterial = new THREE.MeshStandardMaterial({
    color: SKIN[isFemale ? "f" : "m"],
    roughness: 0.78,
  });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x292126, roughness: 0.82 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x211b1a, roughness: 0.45 });

  const addMesh = (geometry, bone, material = skinMaterial) => {
    const mesh = new THREE.SkinnedMesh(addSkinAttributes(geometry, boneIndices.get(bone)), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const torsoGeometry = new THREE.BufferGeometry();
  const torsoPositions = [];
  const torsoIndices = [];
  const rings = [
    [0.79, 0.105, 0.075],
    [0.86, 0.145, 0.09],
    [0.98, isFemale ? 0.15 : 0.145, 0.09],
    [1.08, isFemale ? 0.125 : 0.135, 0.078],
    [1.18, isFemale ? 0.145 : 0.15, 0.09],
    [1.31, isFemale ? 0.17 : 0.18, 0.09],
    [1.4, 0.14, 0.075],
    [1.46, 0.075, 0.065],
  ];
  const segments = 32;
  rings.forEach(([y, rx, rz]) => {
    for (let j = 0; j <= segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      torsoPositions.push(Math.cos(angle) * rx, y, Math.sin(angle) * rz);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      torsoIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  torsoGeometry.setAttribute("position", new THREE.Float32BufferAttribute(torsoPositions, 3));
  torsoGeometry.setIndex(torsoIndices);
  torsoGeometry.computeVertexNormals();
  addMesh(torsoGeometry, hips);

  const sphere = (bone, position, scale, material = skinMaterial, widthSegments = 20, heightSegments = 14) => {
    const mesh = addMesh(new THREE.SphereGeometry(1, widthSegments, heightSegments), bone, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    return mesh;
  };
  const segment = (start, end, radiusStart, radiusEnd, bone, material = skinMaterial) => {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const mesh = addMesh(new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), 16, 12), bone);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    if (material !== skinMaterial) mesh.material = material;
    return mesh;
  };

  sphere(head, [0, 1.63, 0], [0.105, 0.13, 0.105]);
  segment([0, 1.43, 0], [0, 1.52, 0], 0.052, 0.052, neck);
  sphere(head, [0, 1.71, -0.036], [0.11, 0.075, 0.09], hairMaterial);
  sphere(head, [0, 1.65, -0.074], [0.108, 0.08, 0.042], hairMaterial);
  sphere(head, [-0.038, 1.655, 0.09], [0.013, 0.009, 0.007], eyeMaterial, 12, 8);
  sphere(head, [0.038, 1.655, 0.09], [0.013, 0.009, 0.007], eyeMaterial, 12, 8);

  const armPairs = [
    { shoulder: [0.18, 1.2, 0], elbow: [0.18 + armLength, 1.2, 0], wrist: [0.18 + armLength + forearmLength, 1.2, 0], hand: leftHand, arm: leftArm, forearm: leftForeArm, side: 1 },
    { shoulder: [-0.18, 1.2, 0], elbow: [-0.18 - armLength, 1.2, 0], wrist: [-0.18 - armLength - forearmLength, 1.2, 0], hand: rightHand, arm: rightArm, forearm: rightForeArm, side: -1 },
  ];
  armPairs.forEach(({ shoulder, elbow, wrist, hand, arm, forearm, side }) => {
    segment(shoulder, elbow, 0.052, 0.042, arm);
    sphere(arm, elbow, [0.043, 0.043, 0.043]);
    segment(elbow, wrist, 0.041, 0.03, forearm);
    sphere(hand, [wrist[0] + side * 0.035, wrist[1], wrist[2]], [0.032, 0.055, 0.023]);
  });

  [
    { upper: leftUpLeg, lower: leftLeg, foot: leftFoot, x: legWidth },
    { upper: rightUpLeg, lower: rightLeg, foot: rightFoot, x: -legWidth },
  ].forEach(({ upper, lower, foot, x }) => {
    const hip = [x, 0.865, 0];
    const knee = [x, 0.46, 0];
    const ankle = [x, 0.075, 0];
    segment(hip, knee, 0.078, 0.056, upper);
    sphere(upper, knee, [0.057, 0.06, 0.057]);
    segment(knee, ankle, 0.054, 0.034, lower);
    sphere(foot, [x, 0.045, 0.045], [0.045, 0.035, 0.095]);
  });

  group.add(hips);
  group.updateMatrixWorld(true);
  skeleton.calculateInverses();
  group.traverse((object) => {
    if (object.isSkinnedMesh) object.bind(skeleton);
  });
  group.updateMatrixWorld(true);
  return group;
}
